// Synthetic claim scenario shared by circuit and contract tests. Fictional data only.
import * as snarkjs from "snarkjs";
import * as Z from "../lib/insuretrust.js";

export const WASM = "circuits/build/claim_js/claim.wasm";
export const ZKEY = "circuits/build/claim.zkey";

export async function prove(input: any) {
  return snarkjs.groth16.fullProve(input, WASM, ZKEY);
}

// snarkjs proof -> [a, b, c, publicSignals] in the verifier's argument format
export async function toCalldata(proof: any, publicSignals: string[]) {
  return JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
}

export async function scenario({ claimDate = 1_800_000_000n, recipient = "0x" + "11".repeat(20), chainId = 31337n, verifyingContract = "0x" + "22".repeat(20) } = {}) {
  await Z.init();
  const hospitals = [1, 2].map((i) => Z.hospitalKey(new Uint8Array(32).fill(i)));
  const outsider = Z.hospitalKey(new Uint8Array(32).fill(9));
  const hospitalTree = Z.merkleTree(hospitals.map((h) => h.leaf), Z.HOSPITAL_DEPTH);

  const patientId = 1001n;
  const record = { procedureCode: 4401n, diagnosisCode: 1234n, treatmentDataHash: 777n, patientId, recordSalt: 555_555n };
  const policy = Z.makePolicy({
    policyId: 7n, patientId, policyStart: 1_700_000_000n, policyExpiry: 1_900_000_000n,
    policyLimit: 5_000_000n, // ₹50,000 in paise
    policySalt: 424_242n, coveredProcedures: [4401n, 4402n, 5001n],
  });

  const hospital = hospitals[1];
  const signature = Z.signRecord(hospital, Z.recordCommitment(record));
  const base = {
    hospital, hospitalTree, hospitalIndex: 1, record, signature, policy,
    claimAmount: 4_200_000n, // ₹42,000 in paise
    claimDate, recipient, chainId, verifyingContract,
  };
  const input = (over: Record<string, any> = {}) => Z.claimInput({ ...base, ...over });
  return { Z, hospitals, outsider, hospitalTree, record, policy, signature, input };
}
