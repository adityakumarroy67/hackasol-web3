// Proof helper for circuits/claim.circom. Works in Node (tests, demo) AND in the browser (website).
// Builds a claim exactly the way the circuit expects, then creates and checks the proof.
// Every hash here MUST match the circuit, or proofs will fail. Synthetic data only.
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon6, poseidon9 } from "poseidon-lite";
import { Base8, mulPointEscalar, subOrder } from "@zk-kit/baby-jubjub";
import * as snarkjs from "snarkjs";
import { hexToBytes } from "./records.js";

export const HOSPITAL_DEPTH = 8; // approved-hospital list holds up to 2^8 = 256 hospitals
export const COVERED_DEPTH = 5; // covered-procedure list holds up to 2^5 = 32 procedure codes
export const NULLIFIER_DOMAIN = 1003n; // fixed tag so this hash can't be confused with other hashes

// Poseidon hash: the ZK-friendly hash function the circuit uses (same constants as circomlib).
const POSEIDON = { 2: poseidon2, 3: poseidon3, 4: poseidon4, 5: poseidon5, 6: poseidon6, 9: poseidon9 };
export function hash(inputs) {
  const poseidon = POSEIDON[inputs.length];
  if (!poseidon) throw new Error(`no Poseidon for ${inputs.length} inputs`);
  return poseidon(inputs.map(BigInt));
}

// Random secret number (248 bits) for salts and claim IDs.
export function randomSecret() {
  return bytesToBigInt(crypto.getRandomValues(new Uint8Array(31)));
}

// Random ID (120 bits) for policy and claim IDs; the circuit allows up to 128 bits.
export function randomId() {
  return bytesToBigInt(crypto.getRandomValues(new Uint8Array(15)));
}

// Stable claim ID (120 bits) from the facts that identify one claim, e.g. (hospital, bill number).
// A retry of the same bill gets the same ID, so the same one-time code (nullifier): it can't be paid twice.
export async function stableClaimId(...parts) {
  const text = JSON.stringify(["InsureTrust claim id v1", ...parts.map(String)]);
  return bytesToBigInt(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text))).slice(0, 15));
}

const bytesToBigInt = (bytes) => BigInt("0x" + ([...bytes].map((b) => b.toString(16).padStart(2, "0")).join("") || "0"));
const utf8 = (s) => new TextEncoder().encode(s);
async function sha512Number(...parts) {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { all.set(p, i); i += p.length; }
  return bytesToBigInt(new Uint8Array(await crypto.subtle.digest("SHA-512", all)));
}

// Merkle tree: a list fingerprinted into one "root" number.
// A Merkle proof (path) shows one item is in the list without revealing the rest.
export function merkleTree(leaves, depth) {
  const size = 2 ** depth;
  if (leaves.length > size) throw new Error(`list too long: ${leaves.length} > ${size}`);
  const layers = [[...leaves.map(BigInt), ...Array(size - leaves.length).fill(0n)]];
  for (let d = 0; d < depth; d++) {
    const prev = layers[d];
    layers.push(Array.from({ length: prev.length / 2 }, (_, i) => hash([prev[2 * i], prev[2 * i + 1]])));
  }
  return {
    root: layers[depth][0],
    proof(index) {
      const path = [], indices = [];
      for (let d = 0; d < depth; d++) {
        const node = index >> d; // position of our node at this level
        path.push(layers[d][node ^ 1]); // its neighbour
        indices.push(node & 1); // 0 = we are on the left, 1 = on the right
      }
      return { path, indices };
    },
  };
}

// ---------- hospitals ----------
// A hospital has a claim-signing key (EdDSA on the Baby Jubjub curve, checked inside the circuit)
// and a payout wallet. Its approved-list entry = Poseidon(publicKeyX, publicKeyY, payoutAddress).
// secret: 32 secret bytes. Signing key a (1..subOrder-1), public key A = a·B8.
export async function makeHospital(secret, payoutAddress) {
  const a = (await sha512Number(utf8("InsureTrust hospital signing key"), secret)) % (subOrder - 1n) + 1n;
  const nonceSeed = new Uint8Array(await crypto.subtle.digest("SHA-512", new Uint8Array([...utf8("InsureTrust nonce"), ...secret])));
  const [Ax, Ay] = mulPointEscalar(Base8, a);
  const payout = BigInt(payoutAddress);
  return { a, nonceSeed, Ax, Ay, payout, leaf: hash([Ax, Ay, payout]) };
}

export const HOSPITAL_KEY_MESSAGE =
  "InsureTrust: create my hospital claim-signing key.\n\n" +
  "Only sign this message inside the InsureTrust app. It costs nothing and sends no transaction.";

// Same wallet -> same hospital signing key, on any device (wallet signatures are deterministic).
export async function hospitalFromWallet(signer) {
  const signature = hexToBytes(await signer.signMessage(HOSPITAL_KEY_MESSAGE));
  const secret = new Uint8Array(await crypto.subtle.digest("SHA-256", signature));
  return makeHospital(secret, await signer.getAddress());
}

// EdDSA-Poseidon signature that the circuit's EdDSAPoseidonVerifier accepts:
//   S·B8 = R8 + h·(8·A),  h = Poseidon(R8x, R8y, Ax, Ay, message).
// The nonce r is derived from a secret seed and the message (deterministic, like RFC 8032).
export async function signClaim(hospital, message) {
  const msgBytes = hexToBytes(BigInt(message).toString(16).padStart(64, "0"));
  const r = (await sha512Number(hospital.nonceSeed, msgBytes)) % (subOrder - 1n) + 1n;
  const [R8x, R8y] = mulPointEscalar(Base8, r);
  const h = hash([R8x, R8y, hospital.Ax, hospital.Ay, message]);
  const S = (r + h * 8n * hospital.a) % subOrder;
  return { S, R8x, R8y };
}

// ---------- policies ----------
// Policy fingerprint (commitment) = Poseidon(policyId, start, expiry, limit, coveredRoot, salt).
// coveredProcedures is the list of procedure codes the policy pays for.
export function makePolicy({ coveredProcedures, ...terms }) {
  const coveredRoot = merkleTree(coveredProcedures, COVERED_DEPTH).root;
  const policy = { ...terms, coveredProcedures: coveredProcedures.map(BigInt), coveredRoot };
  policy.commitment = hash([policy.policyId, policy.policyStart, policy.policyExpiry, policy.policyLimit, coveredRoot, policy.policySalt]);
  return policy;
}

// One-time claim code: the same claim always gives the same code, so it can't be paid twice.
export const nullifierOf = (policy, claimId) => hash([NULLIFIER_DOMAIN, policy.policyId, claimId, policy.policySalt]);

// The exact message the hospital signs (order must match the circuit).
export const claimMessage = (c) =>
  hash([c.claimAmount, c.claimDate, c.policyCommitment, c.claimNullifier, c.hospitalPayoutAddress, c.claimId, c.procedureCode, c.chainId, c.verifyingContract]);

// Plain-language reasons a claim can't be proved. Same rules as the circuit, checked first
// so people see WHY (the circuit itself only says "no proof").
export function claimProblems({ hospital, hospitals, policy, procedureCode, claimDate, claimAmount, claimSubmissionTime }) {
  const problems = [];
  if (!hospitals.some((h) => h.leaf === hospital.leaf)) problems.push("This hospital is not on the insurer's approved list.");
  if (BigInt(claimDate) < BigInt(policy.policyStart)) problems.push("The treatment date is before the policy started.");
  if (BigInt(claimDate) >= BigInt(policy.policyExpiry)) problems.push("The policy had expired on the treatment date.");
  if (BigInt(claimDate) > BigInt(claimSubmissionTime)) problems.push("The treatment date is in the future.");
  if (!policy.coveredProcedures.map(BigInt).includes(BigInt(procedureCode))) problems.push("This procedure is not covered by the policy.");
  if (BigInt(claimAmount) <= 0n) problems.push("The amount must be more than zero.");
  if (BigInt(claimAmount) > BigInt(policy.policyLimit)) problems.push("The amount is above the policy limit.");
  return problems;
}

// Build every circuit input for one claim. The hospital signs it here.
// signer: who signs (defaults to the claiming hospital; tests pass a different one to cheat).
export async function buildClaim({ hospital, hospitals, policy, claimId, procedureCode, claimDate, claimAmount, claimSubmissionTime, chainId, verifyingContract, signer = hospital }) {
  const hospitalTree = merkleTree(hospitals.map((h) => h.leaf), HOSPITAL_DEPTH);
  const hospitalIndex = Math.max(hospitals.findIndex((h) => h.leaf === hospital.leaf), 0); // unlisted -> wrong path, circuit rejects
  const hp = hospitalTree.proof(hospitalIndex);

  const covered = merkleTree(policy.coveredProcedures, COVERED_DEPTH);
  const procIndex = policy.coveredProcedures.map(BigInt).indexOf(BigInt(procedureCode));
  const cp = covered.proof(Math.max(procIndex, 0)); // uncovered procedure -> wrong path, circuit rejects

  const pub = {
    approvedHospitalRoot: hospitalTree.root,
    policyCommitment: policy.commitment,
    claimNullifier: nullifierOf(policy, BigInt(claimId)),
    claimAmount: BigInt(claimAmount),
    hospitalPayoutAddress: hospital.payout,
    claimSubmissionTime: BigInt(claimSubmissionTime),
    chainId: BigInt(chainId),
    verifyingContract: BigInt(verifyingContract),
  };
  const sig = await signClaim(signer, claimMessage({ ...pub, claimDate: BigInt(claimDate), claimId: BigInt(claimId), procedureCode: BigInt(procedureCode) }));

  return {
    ...pub,
    hospitalAx: hospital.Ax, hospitalAy: hospital.Ay,
    hospitalSignatureS: sig.S, hospitalSignatureR8x: sig.R8x, hospitalSignatureR8y: sig.R8y,
    hospitalPath: hp.path, hospitalPathIndices: hp.indices,
    policyId: BigInt(policy.policyId), claimId: BigInt(claimId), claimDate: BigInt(claimDate),
    policyStart: BigInt(policy.policyStart), policyExpiry: BigInt(policy.policyExpiry), policyLimit: BigInt(policy.policyLimit),
    coveredRoot: BigInt(policy.coveredRoot), policySalt: BigInt(policy.policySalt),
    procedureCode: BigInt(procedureCode), coveredPath: cp.path, coveredPathIndices: cp.indices,
  };
}

// Order of the 8 public values in a proof (same order as the circuit declares them).
export const PUBLIC_SIGNALS = ["approvedHospitalRoot", "policyCommitment", "claimNullifier", "claimAmount", "hospitalPayoutAddress", "claimSubmissionTime", "chainId", "verifyingContract"];

// Create a proof. Throws if ANY rule fails: an invalid claim cannot get a proof.
// wasm/zkey: file paths in Node, URLs in the browser.
export const proveClaim = (input, wasm, zkey) => snarkjs.groth16.fullProve(input, wasm, zkey);

// Check a proof off-chain (the smart contract does the same check on-chain).
export const verifyClaim = (vkey, publicSignals, proof) => snarkjs.groth16.verify(vkey, publicSignals, proof);

// Convert a proof into the argument format of ClaimVerifier.sol: [a, b, c, publicSignals].
export async function toCalldata(proof, publicSignals) {
  return JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
}

// JSON that keeps big numbers exact (policy files, proof packages): 123n <-> "123n".
export const toJson = (value) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? `${v}n` : v));
export const fromJson = (text) => JSON.parse(text, (_, v) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
