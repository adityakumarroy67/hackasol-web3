// Shared ZK helpers for tests, seed scripts and the frontend.
// Every hash here must match circuits/claim.circom exactly.
import { buildPoseidon, buildEddsa } from "circomlibjs";

export const HOSPITAL_DEPTH = 4;
export const COVERED_DEPTH = 4;

let poseidon, eddsa, F;
export async function init() {
  if (!poseidon) {
    [poseidon, eddsa] = await Promise.all([buildPoseidon(), buildEddsa()]);
    F = poseidon.F;
  }
}

export const hash = (inputs) => F.toObject(poseidon(inputs.map(BigInt)));

// Random field element (< 2^248) for salts and secrets.
export function randomField() {
  const b = crypto.getRandomValues(new Uint8Array(31));
  return BigInt("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join(""));
}

// Fixed-depth Poseidon Merkle tree, zero-padded. Leaves are field elements.
export function merkleTree(leaves, depth) {
  const size = 2 ** depth;
  if (leaves.length > size) throw new Error(`tree full: ${leaves.length} > ${size}`);
  const layers = [[...leaves.map(BigInt), ...Array(size - leaves.length).fill(0n)]];
  for (let d = 0; d < depth; d++) {
    const prev = layers[d];
    layers.push(Array.from({ length: prev.length / 2 }, (_, i) => hash([prev[2 * i], prev[2 * i + 1]])));
  }
  return {
    root: layers[depth][0],
    proof(index) {
      const path = [], idx = [];
      for (let d = 0; d < depth; d++) {
        const node = index >> d;
        path.push(layers[d][node ^ 1]);
        idx.push(node & 1);
      }
      return { path, idx };
    },
  };
}

// ---------- hospitals ----------
// privKey: 32 bytes. Leaf = Poseidon(Ax, Ay).
export function hospitalKey(privKey) {
  const [Ax, Ay] = eddsa.prv2pub(privKey).map((p) => F.toObject(p));
  return { privKey, Ax, Ay, leaf: hash([Ax, Ay]) };
}

export function signRecord(hospital, recordCommitment) {
  const sig = eddsa.signPoseidon(hospital.privKey, F.e(recordCommitment));
  return { R8x: F.toObject(sig.R8[0]), R8y: F.toObject(sig.R8[1]), S: sig.S };
}

// ---------- records & policies ----------
export const recordCommitment = (r) =>
  hash([r.procedureCode, r.diagnosisCode, r.treatmentDataHash, r.patientId, r.recordSalt]);

export const policyCommitment = (p) =>
  hash([p.policyId, p.patientId, p.policyStart, p.policyExpiry, p.policyLimit, p.coveredRoot, p.policySalt]);

export const nullifierOf = (record) => hash([record.recordSalt, recordCommitment(record)]);

// Build the full circuit input. policy.coveredProcedures is the list whose Merkle root is coveredRoot.
export function claimInput({ hospital, hospitalTree, hospitalIndex, record, signature, policy, claimAmount, claimDate, recipient, chainId, verifyingContract }) {
  const covered = merkleTree(policy.coveredProcedures, COVERED_DEPTH);
  const procIndex = policy.coveredProcedures.map(BigInt).indexOf(BigInt(record.procedureCode));
  // Uncovered procedure: use index 0's path; the circuit will reject it.
  const cp = covered.proof(Math.max(procIndex, 0));
  const hp = hospitalTree.proof(hospitalIndex);
  const rc = recordCommitment(record);
  return {
    hospitalRoot: hospitalTree.root,
    policyCommitment: policyCommitment(policy),
    nullifier: nullifierOf(record),
    claimAmount, claimDate,
    recordCommitment: rc,
    recipient: BigInt(recipient), chainId: BigInt(chainId), verifyingContract: BigInt(verifyingContract),
    hospitalAx: hospital.Ax, hospitalAy: hospital.Ay,
    sigR8x: signature.R8x, sigR8y: signature.R8y, sigS: signature.S,
    hospitalPath: hp.path, hospitalIdx: hp.idx,
    procedureCode: record.procedureCode, diagnosisCode: record.diagnosisCode,
    treatmentDataHash: record.treatmentDataHash, patientId: record.patientId, recordSalt: record.recordSalt,
    policyId: policy.policyId, policyStart: policy.policyStart, policyExpiry: policy.policyExpiry,
    policyLimit: policy.policyLimit, coveredRoot: policy.coveredRoot, policySalt: policy.policySalt,
    coveredPath: cp.path, coveredIdx: cp.idx,
  };
}

// Policy helper: fills coveredRoot from coveredProcedures.
export function makePolicy(p) {
  return { ...p, coveredRoot: merkleTree(p.coveredProcedures, COVERED_DEPTH).root };
}
