pragma circom 2.2.0;

// InsureTrust claim circuit (W3-01).
// Proves, without revealing diagnosis / procedure / record contents, that:
//  1. the record is signed by a hospital whose key is in the approved-hospital Merkle tree
//  2. the policy is active on the claim date (start <= claimDate < expiry)
//  3. the procedure is in the policy's covered set (Merkle) and amount <= limit
//  4. the record and policy belong to the same patient, and the record matches recordCommitment
//  5. nullifier is derived from the per-record secret (one claim per record)
//  6. recipient, chainId and contract address are bound to the proof

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/eddsaposeidon.circom";

// Merkle root from leaf + path. Direction bits are forced to 0/1.
template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    signal hashes[depth + 1];
    signal left[depth];
    signal right[depth];
    hashes[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        // index 0: current node is left; index 1: current node is right
        left[i] <== hashes[i] + pathIndices[i] * (pathElements[i] - hashes[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (hashes[i] - pathElements[i]);
        hashes[i + 1] <== Poseidon(2)([left[i], right[i]]);
    }
    root <== hashes[depth];
}

// a <= b for 64-bit values, with explicit range checks (prevents field wrap-around).
template LessEq64() {
    signal input a;
    signal input b;
    _ <== Num2Bits(64)(a);
    _ <== Num2Bits(64)(b);
    signal ok <== LessEqThan(64)([a, b]);
    ok === 1;
}

template Claim(HOSPITAL_DEPTH, COVERED_DEPTH) {
    // ---------- public ----------
    signal input hospitalRoot;
    signal input policyCommitment;
    signal input nullifier;
    signal input claimAmount;      // whole tINR
    signal input claimDate;        // unix seconds
    signal input recordCommitment;
    signal input recipient;
    signal input chainId;
    signal input verifyingContract;

    // ---------- private: hospital ----------
    signal input hospitalAx;
    signal input hospitalAy;
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;
    signal input hospitalPath[HOSPITAL_DEPTH];
    signal input hospitalIdx[HOSPITAL_DEPTH];

    // ---------- private: record ----------
    signal input procedureCode;
    signal input diagnosisCode;
    signal input treatmentDataHash;  // hash of prescriptions / full FHIR record
    signal input patientId;
    signal input recordSalt;

    // ---------- private: policy ----------
    signal input policyId;
    signal input policyStart;
    signal input policyExpiry;
    signal input policyLimit;
    signal input coveredRoot;
    signal input policySalt;
    signal input coveredPath[COVERED_DEPTH];
    signal input coveredIdx[COVERED_DEPTH];

    // 1. approved hospital signed this exact record
    signal hospitalLeaf <== Poseidon(2)([hospitalAx, hospitalAy]);
    signal computedHospitalRoot <== MerkleRoot(HOSPITAL_DEPTH)(hospitalLeaf, hospitalPath, hospitalIdx);
    computedHospitalRoot === hospitalRoot;

    signal computedRecord <== Poseidon(5)([procedureCode, diagnosisCode, treatmentDataHash, patientId, recordSalt]);
    computedRecord === recordCommitment;

    EdDSAPoseidonVerifier()(1, hospitalAx, hospitalAy, sigS, sigR8x, sigR8y, recordCommitment);

    // 2. policy commitment opens correctly (same patientId as the record) and is active
    signal computedPolicy <== Poseidon(7)([policyId, patientId, policyStart, policyExpiry, policyLimit, coveredRoot, policySalt]);
    computedPolicy === policyCommitment;

    LessEq64()(policyStart, claimDate);
    LessEq64()(claimDate + 1, policyExpiry);   // claimDate < expiry

    // 3. procedure covered, amount within limit
    signal computedCovered <== MerkleRoot(COVERED_DEPTH)(procedureCode, coveredPath, coveredIdx);
    computedCovered === coveredRoot;
    LessEq64()(claimAmount, policyLimit);

    // 5. one claim per record
    signal computedNullifier <== Poseidon(2)([recordSalt, recordCommitment]);
    computedNullifier === nullifier;

    // 6. bind public values that no other constraint touches
    signal recipientSq <== recipient * recipient;
    signal chainSq <== chainId * chainId;
    signal contractSq <== verifyingContract * verifyingContract;
}

component main {public [hospitalRoot, policyCommitment, nullifier, claimAmount, claimDate, recordCommitment, recipient, chainId, verifyingContract]} = Claim(4, 4);
