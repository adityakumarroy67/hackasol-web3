// Encrypted medical records: locking, key sharing and content IDs (CIDs).
// Uses only the Web Crypto API that browsers and Node 24 already include — no extra libraries.
//
// In plain words:
//  - Each record is locked with its own random key (AES-256-GCM).
//  - That key is locked again ("wrapped") separately for each person allowed to read it,
//    using their public key (X25519). Only their private key can unwrap it.
//  - Personal keys are re-created from a wallet signature: same wallet -> same keys, on any device.
//  - Files are named by their fingerprint (CID), exactly like IPFS, so any change is detected.

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();

export const KEY_MESSAGE =
  "InsureTrust: create my health-record encryption key.\n\n" +
  "Only sign this message inside the InsureTrust app. It costs nothing and sends no transaction.";
const WRAP_INFO = utf8.encode("InsureTrust key wrap v1");
const X25519_PKCS8_PREFIX = hexToBytes("302e020100300506032b656e04220420"); // standard header for a raw X25519 private key

// ---------- small byte helpers ----------
export function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
}
export const bytesToHex = (bytes) => "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

// ---------- 1. personal encryption keys ----------
// signer: any ethers signer (MetaMask in the browser, a test wallet in Node).
// Wallet signatures are deterministic, so the same wallet always gets the same keys.
export async function deriveKeys(signer) {
  const signature = hexToBytes(await signer.signMessage(KEY_MESSAGE));
  const seed = new Uint8Array(await subtle.digest("SHA-256", signature));
  const pkcs8 = concat(X25519_PKCS8_PREFIX, seed);
  const exportable = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, ["deriveBits"]);
  const publicKey = fromBase64Url((await subtle.exportKey("jwk", exportable)).x); // 32 bytes, safe to publish
  const privateKey = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, false, ["deriveBits"]); // never exportable
  return { publicKey, privateKey };
}

// ---------- 2. lock / unlock a record ----------
export async function encryptRecord(record) {
  const key = random(32);
  const iv = random(12); // fresh for every file
  const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const sealed = await subtle.encrypt({ name: "AES-GCM", iv }, aes, utf8.encode(JSON.stringify(record)));
  return { ciphertext: concat(iv, new Uint8Array(sealed)), key };
}

// Fails (throws) if the key is wrong or the file was changed: AES-GCM includes a built-in check tag.
export async function decryptRecord(ciphertext, key) {
  const aes = await subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: ciphertext.slice(0, 12) }, aes, ciphertext.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- 3. share a record key with one person ----------
// Result (92 bytes): one-time public key (32) | iv (12) | locked record key (32 + 16-byte check tag)
export async function wrapKey(recordKey, recipientPublicKey) {
  const oneTime = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const oneTimePublic = new Uint8Array(await subtle.exportKey("raw", oneTime.publicKey));
  const recipient = await subtle.importKey("raw", recipientPublicKey, { name: "X25519" }, false, []);
  const lock = await wrappingKey(oneTime.privateKey, recipient, oneTimePublic, recipientPublicKey);
  const iv = random(12);
  const sealed = await subtle.encrypt({ name: "AES-GCM", iv }, lock, recordKey);
  return concat(oneTimePublic, iv, new Uint8Array(sealed));
}

// Throws if this wrapped key was not made for `myKeys`.
export async function unwrapKey(wrapped, myKeys) {
  const oneTimePublic = wrapped.slice(0, 32);
  const sender = await subtle.importKey("raw", oneTimePublic, { name: "X25519" }, false, []);
  const lock = await wrappingKey(myKeys.privateKey, sender, oneTimePublic, myKeys.publicKey);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: wrapped.slice(32, 44) }, lock, wrapped.slice(44)));
}

// Both sides compute the same secret (X25519), then turn it into an AES key (HKDF).
async function wrappingKey(myPrivate, theirPublic, oneTimePublic, recipientPublic) {
  const shared = await subtle.deriveBits({ name: "X25519", public: theirPublic }, myPrivate, 256);
  const material = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: concat(oneTimePublic, recipientPublic), info: WRAP_INFO },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// ---------- 4. content ID (CID) ----------
// CIDv1 "raw" + SHA-256: the same ID `ipfs add --cid-version=1 --raw-leaves` gives for files up to 256 KB.
// So local storage and real IPFS use identical IDs and can be swapped freely.
const MAX_SINGLE_BLOCK = 256 * 1024;
export async function cidOf(bytes) {
  if (bytes.length > MAX_SINGLE_BLOCK) throw new Error("file too large for a single-block CID (max 256 KB)");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return "b" + base32(concat(Uint8Array.of(0x01, 0x55, 0x12, 0x20), digest)); // version 1 | raw | sha2-256 | 32 bytes
}
function base32(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "", bits = 0, value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += alphabet[(value >> bits) & 31]; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

// ---------- 5. storage ----------
// Any storage works if it has put(bytes) -> cid and get(cid) -> bytes.
// get() always re-checks the fingerprint, so a modified or swapped file is rejected.
export async function verifiedFile(cid, bytes) {
  if (!bytes) throw new Error(`file not found: ${cid}`);
  if ((await cidOf(bytes)) !== cid) throw new Error(`file ${cid} was modified (fingerprint mismatch)`);
  return bytes;
}

export function memoryStore() {
  const files = new Map();
  return {
    label: "in-memory demo storage (NOT public IPFS)",
    files,
    async put(bytes) { const cid = await cidOf(bytes); files.set(cid, bytes); return cid; },
    async get(cid) { return verifiedFile(cid, files.get(cid)); },
  };
}

// Real IPFS, through a Kubo node's HTTP API (e.g. the Docker "ipfs" service).
// Files are added as CIDv1 raw blocks, so IPFS's ID equals cidOf() exactly (double-checked on every upload).
export function ipfsStore(apiUrl) {
  async function call(path, init = {}) {
    const res = await fetch(`${apiUrl}/api/v0/${path}`, { method: "POST", signal: AbortSignal.timeout(15_000), ...init });
    if (!res.ok) throw new Error(`IPFS ${path.split("?")[0]} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  return {
    label: `IPFS node at ${apiUrl}`,
    async put(bytes) {
      const form = new FormData();
      form.append("file", new Blob([bytes]));
      const { Hash } = await (await call("add?cid-version=1&raw-leaves=true&pin=true", { body: form })).json();
      if (Hash !== (await cidOf(bytes))) throw new Error(`IPFS returned an unexpected content ID: ${Hash}`);
      return Hash;
    },
    async get(cid) {
      const res = await call(`cat?arg=${encodeURIComponent(cid)}`);
      return verifiedFile(cid, new Uint8Array(await res.arrayBuffer()));
    },
  };
}

// ---------- 6. a small FHIR-shaped record (synthetic data only; not the full FHIR standard) ----------
export function fhirRecord({ patientRef, patientName, condition, procedureCode, procedureName, date, medications = [] }) {
  return {
    resourceType: "Bundle",
    type: "document",
    entry: [
      { resource: { resourceType: "Patient", id: patientRef, name: [{ text: patientName }] } },
      { resource: { resourceType: "Condition", subject: { reference: `Patient/${patientRef}` }, code: { text: condition } } },
      { resource: { resourceType: "Procedure", subject: { reference: `Patient/${patientRef}` }, performedDateTime: date,
          code: { coding: [{ code: String(procedureCode), display: procedureName }] } } },
      ...medications.map((m) => ({ resource: { resourceType: "MedicationRequest", subject: { reference: `Patient/${patientRef}` }, medicationCodeableConcept: { text: m } } })),
    ],
  };
}
