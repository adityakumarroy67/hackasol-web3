// Off-chain data shared between roles in the demo, plus storage for locked record files.
//
// The "inbox" lives in this browser (localStorage). It SIMULATES handing files between people
// (a policy file from insurer to patient, a proof package from hospital to patient). In real life
// these would travel by email, QR code or an app; nothing secret is put on the blockchain.
import { useSyncExternalStore } from "react";
import { HOSPITAL_DEPTH, fromJson, hash, merkleTree, toJson } from "../../lib/claim.js";
import * as R from "../../lib/records.js";

const EMPTY = { people: {}, hospitalKeys: {}, approvedHospitals: [], policies: {}, policyShares: {}, claims: {}, cases: {} };
const listeners = new Set();
let storageKey = null;
let inbox = EMPTY;

const load = () => {
  try { return { ...structuredClone(EMPTY), ...fromJson(localStorage.getItem(storageKey) ?? "{}") }; }
  catch { return structuredClone(EMPTY); }
};

export function openInbox(session) {
  storageKey = `insuretrust:${session.chainId}:${session.deployment.deploymentId}`;
  inbox = load();
  listeners.forEach((l) => l());
}

// Another tab of this site saved: show its changes here too.
addEventListener("storage", (e) => {
  if (storageKey && e.key === storageKey) { inbox = load(); listeners.forEach((l) => l()); }
});

// change(draft) edits a fresh copy of what's saved (another tab may have saved since), then saves.
export function updateInbox(change) {
  const draft = load();
  change(draft);
  inbox = draft;
  localStorage.setItem(storageKey, toJson(inbox));
  listeners.forEach((l) => l());
}

export function resetInbox() {
  if (storageKey) localStorage.removeItem(storageKey);
  inbox = EMPTY;
  listeners.forEach((l) => l());
}

export const inboxNow = () => inbox; // for code outside React (sign-in checks)

export function useInbox() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => inbox);
}

// Display name for an address, if known. (All inbox keys are lowercase addresses.)
export const nameOf = (address, people = inbox.people) => (address && people[address.toLowerCase()]?.name) || null;

// The insurer's approved-hospital list, as Merkle-tree entries: Poseidon(keyX, keyY, payoutAddress).
export function approvedList(box = inbox) {
  return box.approvedHospitals
    .map((address) => {
      const key = box.hospitalKeys[address];
      return key && { address, name: key.name, leaf: hash([key.Ax, key.Ay, BigInt(address)]) };
    })
    .filter(Boolean);
}
export const rootOf = (list) => merkleTree(list.map((h) => h.leaf), HOSPITAL_DEPTH).root;

// ---------- storage for locked (encrypted) record files ----------
// Real IPFS when the local IPFS node is reachable (dev server in Docker); otherwise this browser.
// Both use the same content IDs, so the blockchain data is identical either way.
export async function openStorage() {
  if (import.meta.env.DEV) {
    const api = new URL("/ipfs-api", location.origin).href;
    try {
      const res = await fetch(`${api}/api/v0/version`, { method: "POST", signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        return { ...R.ipfsStore(api), kind: "ipfs", label: "IPFS (local node)", viewUrl: (cid) => `/ipfs/${cid}` };
      }
    } catch {}
  }
  return {
    kind: "browser",
    label: "This browser (not IPFS)",
    viewUrl: null,
    async put(bytes) {
      const cid = await R.cidOf(bytes);
      let text = ""; // in slices: spreading a 256 KB file into one call overflows the stack
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(`insuretrust-file:${cid}`, btoa(text));
      return cid;
    },
    async get(cid) {
      const saved = localStorage.getItem(`insuretrust-file:${cid}`);
      return R.verifiedFile(cid, saved ? Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)) : undefined);
    },
  };
}

// Download / upload a JSON file (the "real life" way to hand over a policy file or proof package).
export function downloadJson(filename, value) {
  const url = URL.createObjectURL(new Blob([toJson(value)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}
export const readJsonFile = async (file) => fromJson(await file.text());
