// Proof helper for circuits/claim.circom.
// Builds a claim exactly the way the circuit expects, then creates and checks the proof.
// Every hash here MUST match the circuit, or proofs will fail.
// Used by tests now; later by the demo script and the website. Synthetic data only.
import { buildPoseidon, buildEddsa } from "circomlibjs";
import * as snarkjs from "snarkjs";

export const HOSPITAL_DEPTH = 8; // approved-hospital list holds up to 2^8 = 256 hospitals
export const COVERED_DEPTH = 5; // covered-procedure list holds up to 2^5 = 32 procedure codes
export const NULLIFIER_DOMAIN = 1003n; // fixed tag so this hash can't be confused with other hashes

let poseidon, eddsa, F;

// Load the hash and signature libraries once (they are slow to start).
export async function init() {
  if (!poseidon) {
    [poseidon, eddsa] = await Promise.all([buildPoseidon(), buildEddsa()]);
    F = poseidon.F;
  }
}

// Poseidon hash: the ZK-friendly hash function the circuit uses.
export const hash = (inputs) => F.toObject(poseidon(inputs.map(BigInt)));

// Random secret number (248 bits) for salts and claim IDs.
export function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return BigInt("0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
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
// A hospital has a signing key (EdDSA on the Baby Jubjub curve) and a payout wallet.
// Its list entry = Poseidon(publicKeyX, publicKeyY, payoutAddress).
export function makeHospital(privateKey, payoutAddress) {
  const [Ax, Ay] = eddsa.prv2pub(privateKey).map((p) => F.toObject(p));
  const payout = BigInt(payoutAddress);
  return { privateKey, Ax, Ay, payout, leaf: hash([Ax, Ay, payout]) };
}

// ---------- policies ----------
// Policy fingerprint (commitment) = Poseidon(policyId, start, expiry, limit, coveredRoot, salt).
// coveredProcedures is the list of procedure codes the policy pays for.
export function makePolicy({ coveredProcedures, ...terms }) {
  const coveredRoot = merkleTree(coveredProcedures, COVERED_DEPTH).root;
  const policy = { ...terms, coveredProcedures, coveredRoot };
  policy.commitment = hash([policy.policyId, policy.policyStart, policy.policyExpiry, policy.policyLimit, coveredRoot, policy.policySalt]);
  return policy;
}

// One-time claim code: the same claim always gives the same code, so it can't be paid twice.
export const nullifierOf = (policy, claimId) => hash([NULLIFIER_DOMAIN, policy.policyId, claimId, policy.policySalt]);

// The exact message the hospital signs (order must match the circuit).
export const claimMessage = (c) =>
  hash([c.claimAmount, c.claimDate, c.policyCommitment, c.claimNullifier, c.hospitalPayoutAddress, c.claimId, c.procedureCode, c.chainId, c.verifyingContract]);

export function signClaim(hospital, message) {
  const sig = eddsa.signPoseidon(hospital.privateKey, F.e(message));
  return { S: sig.S, R8x: F.toObject(sig.R8[0]), R8y: F.toObject(sig.R8[1]) };
}

// Build every circuit input for one claim. The hospital signs it here.
// signer: who signs (defaults to the claiming hospital; tests pass a different one to cheat).
export function buildClaim({ hospital, hospitals, policy, claimId, procedureCode, claimDate, claimAmount, claimSubmissionTime, chainId, verifyingContract, signer = hospital }) {
  const hospitalTree = merkleTree(hospitals.map((h) => h.leaf), HOSPITAL_DEPTH);
  const hospitalIndex = Math.max(hospitals.indexOf(hospital), 0); // unlisted hospital -> wrong path, circuit rejects
  const hp = hospitalTree.proof(hospitalIndex);

  const covered = merkleTree(policy.coveredProcedures, COVERED_DEPTH);
  const procIndex = policy.coveredProcedures.map(BigInt).indexOf(BigInt(procedureCode));
  const cp = covered.proof(Math.max(procIndex, 0)); // uncovered procedure -> wrong path, circuit rejects

  const pub = {
    approvedHospitalRoot: hospitalTree.root,
    policyCommitment: policy.commitment,
    claimNullifier: nullifierOf(policy, claimId),
    claimAmount: BigInt(claimAmount),
    hospitalPayoutAddress: hospital.payout,
    claimSubmissionTime: BigInt(claimSubmissionTime),
    chainId: BigInt(chainId),
    verifyingContract: BigInt(verifyingContract),
  };
  const sig = signClaim(signer, claimMessage({ ...pub, claimDate: BigInt(claimDate), claimId: BigInt(claimId), procedureCode: BigInt(procedureCode) }));

  return {
    ...pub,
    hospitalAx: hospital.Ax, hospitalAy: hospital.Ay,
    hospitalSignatureS: sig.S, hospitalSignatureR8x: sig.R8x, hospitalSignatureR8y: sig.R8y,
    hospitalPath: hp.path, hospitalPathIndices: hp.indices,
    policyId: policy.policyId, claimId: BigInt(claimId), claimDate: BigInt(claimDate),
    policyStart: policy.policyStart, policyExpiry: policy.policyExpiry, policyLimit: policy.policyLimit,
    coveredRoot: policy.coveredRoot, policySalt: policy.policySalt,
    procedureCode: BigInt(procedureCode), coveredPath: cp.path, coveredPathIndices: cp.indices,
  };
}

// Order of the 8 public values in a proof (same order as the circuit declares them).
export const PUBLIC_SIGNALS = ["approvedHospitalRoot", "policyCommitment", "claimNullifier", "claimAmount", "hospitalPayoutAddress", "claimSubmissionTime", "chainId", "verifyingContract"];

// Create a proof. Throws if ANY rule fails: an invalid claim cannot get a proof.
export const proveClaim = (input, wasmPath, zkeyPath) => snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

// Check a proof off-chain (the smart contract does the same check on-chain).
export const verifyClaim = (vkey, publicSignals, proof) => snarkjs.groth16.verify(vkey, publicSignals, proof);

// Convert a proof into the argument format of ClaimVerifier.sol: [a, b, c, publicSignals].
export async function toCalldata(proof, publicSignals) {
  return JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
}
