pragma circom 2.2.0;

// Integrated health-claim circuit draft.
//
// Public inputs: approvedHospitalRoot, policyCommitment, claimNullifier,
// claimAmount, hospitalPayoutAddress, claimSubmissionTime, chainId, and
// verifyingContract.
// Private inputs include the policy dates/limit/covered root, procedure code,
// hospital signing key and Merkle path, claim ID, claim date, and signature.
//
// The settlement contract must separately check that policyCommitment was
// registered by the insurer, approvedHospitalRoot is current/accepted,
// claimNullifier is unused, and claimSubmissionTime <= block.timestamp.
// It must also check chainId == block.chainid and verifyingContract == address(this).
// A retry must reuse the same claim ID and policy salt. The circuit does not
// authenticate who issued the claim ID; a different ID creates a different
// nullifier, so it cannot detect duplicate services with newly invented IDs.

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/eddsaposeidon.circom";

template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    signal hashes[depth + 1];
    signal left[depth];
    signal right[depth];
    component nodeHash[depth];

    hashes[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        left[i] <== hashes[i] + pathIndices[i] * (pathElements[i] - hashes[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (hashes[i] - pathElements[i]);

        nodeHash[i] = Poseidon(2);
        nodeHash[i].inputs[0] <== left[i];
        nodeHash[i].inputs[1] <== right[i];
        hashes[i + 1] <== nodeHash[i].out;
    }

    root <== hashes[depth];
}

template Claim(HOSPITAL_DEPTH, COVERED_DEPTH) {
    // ---------- public inputs ----------
    signal input approvedHospitalRoot;
    signal input policyCommitment;
    signal input claimNullifier;
    signal input claimAmount; // Unsigned 128-bit integer in the token's smallest unit.
    signal input hospitalPayoutAddress;
    signal input claimSubmissionTime; // UTC Unix seconds; contract checks it against block.timestamp.
    signal input chainId;
    signal input verifyingContract;

    // ---------- private hospital evidence ----------
    signal input hospitalAx;
    signal input hospitalAy;
    signal input hospitalSignatureS;
    signal input hospitalSignatureR8x;
    signal input hospitalSignatureR8y;
    signal input hospitalPath[HOSPITAL_DEPTH];
    signal input hospitalPathIndices[HOSPITAL_DEPTH];

    // ---------- private claim and policy data ----------
    signal input policyId;
    signal input claimId;
    signal input claimDate; // UTC Unix seconds, using the same unit as policy dates.
    signal input policyStart; // UTC Unix seconds.
    signal input policyExpiry; // UTC Unix seconds; expiry is exclusive.
    signal input policyLimit; // Same integer unit as claimAmount; must fit 128 bits.
    signal input coveredRoot;
    signal input policySalt; // Generate with a cryptographically secure random source.
    signal input procedureCode;
    signal input coveredPath[COVERED_DEPTH];
    signal input coveredPathIndices[COVERED_DEPTH];

    // Amounts use 128 bits so common token precisions have sufficient range.
    // The settlement contract must reject amounts above this circuit range.
    component claimAmountBits = Num2Bits(128);
    component policyLimitBits = Num2Bits(128);
    component claimDateBits = Num2Bits(64);
    component policyStartBits = Num2Bits(64);
    component policyExpiryBits = Num2Bits(64);
    component submissionTimeBits = Num2Bits(64);
    claimAmountBits.in <== claimAmount;
    policyLimitBits.in <== policyLimit;
    claimDateBits.in <== claimDate;
    policyStartBits.in <== policyStart;
    policyExpiryBits.in <== policyExpiry;
    submissionTimeBits.in <== claimSubmissionTime;

    component payoutAddressBits = Num2Bits(160);
    payoutAddressBits.in <== hospitalPayoutAddress;

    component chainIdBits = Num2Bits(64);
    chainIdBits.in <== chainId;

    component verifierAddressBits = Num2Bits(160);
    verifierAddressBits.in <== verifyingContract;

    // A private claim ID is bounded to 128 bits. It must be stable for retries.
    // This circuit does not prove which organization issued the ID.
    component claimIdBits = Num2Bits(128);
    claimIdBits.in <== claimId;

    component policyIdBits = Num2Bits(128);
    policyIdBits.in <== policyId;

    // The approved hospital leaf binds the proof-signing key and payout wallet.
    component hospitalLeafHash = Poseidon(3);
    hospitalLeafHash.inputs[0] <== hospitalAx;
    hospitalLeafHash.inputs[1] <== hospitalAy;
    hospitalLeafHash.inputs[2] <== hospitalPayoutAddress;

    component hospitalMembership = MerkleRoot(HOSPITAL_DEPTH);
    hospitalMembership.leaf <== hospitalLeafHash.out;
    for (var h = 0; h < HOSPITAL_DEPTH; h++) {
        hospitalMembership.pathElements[h] <== hospitalPath[h];
        hospitalMembership.pathIndices[h] <== hospitalPathIndices[h];
    }
    hospitalMembership.root === approvedHospitalRoot;

    // The insurer-authorized policy commitment covers every term used here.
    // Contract state must separately confirm that the insurer registered it.
    component policyHash = Poseidon(6);
    policyHash.inputs[0] <== policyId;
    policyHash.inputs[1] <== policyStart;
    policyHash.inputs[2] <== policyExpiry;
    policyHash.inputs[3] <== policyLimit;
    policyHash.inputs[4] <== coveredRoot;
    policyHash.inputs[5] <== policySalt;
    policyHash.out === policyCommitment;

    // The policy includes its start date and excludes its expiry date.
    component startPassed = LessEqThan(64);
    startPassed.in[0] <== policyStart;
    startPassed.in[1] <== claimDate;

    component expiryNotReached = LessThan(64);
    expiryNotReached.in[0] <== claimDate;
    expiryNotReached.in[1] <== policyExpiry;

    // The contract must enforce claimSubmissionTime <= block.timestamp.
    component dateNotInFuture = LessEqThan(64);
    dateNotInFuture.in[0] <== claimDate;
    dateNotInFuture.in[1] <== claimSubmissionTime;

    component amountWithinLimit = LessEqThan(128);
    amountWithinLimit.in[0] <== claimAmount;
    amountWithinLimit.in[1] <== policyLimit;

    component amountIsPositive = GreaterThan(128);
    amountIsPositive.in[0] <== claimAmount;
    amountIsPositive.in[1] <== 0;

    // The procedure code stays private; only membership in the covered set is
    // proved. The covered root is itself part of the policy commitment above.
    component coveredMembership = MerkleRoot(COVERED_DEPTH);
    coveredMembership.leaf <== procedureCode;
    for (var c = 0; c < COVERED_DEPTH; c++) {
        coveredMembership.pathElements[c] <== coveredPath[c];
        coveredMembership.pathIndices[c] <== coveredPathIndices[c];
    }
    coveredMembership.root === coveredRoot;

    // A stable claim ID and policy-scoped secret give the same claim the same
    // nullifier without exposing a low-entropy claim ID to public observers.
    // Domain value 1003 separates this hash use from other Poseidon hashes.
    component nullifierHash = Poseidon(4);
    nullifierHash.inputs[0] <== 1003;
    nullifierHash.inputs[1] <== policyId;
    nullifierHash.inputs[2] <== claimId;
    nullifierHash.inputs[3] <== policySalt;
    nullifierHash.out === claimNullifier;

    // The hospital signs the exact amount, date, policy, nullifier, payee,
    // claim ID, and private procedure code proved by this circuit.
    component signedClaimHash = Poseidon(9);
    signedClaimHash.inputs[0] <== claimAmount;
    signedClaimHash.inputs[1] <== claimDate;
    signedClaimHash.inputs[2] <== policyCommitment;
    signedClaimHash.inputs[3] <== claimNullifier;
    signedClaimHash.inputs[4] <== hospitalPayoutAddress;
    signedClaimHash.inputs[5] <== claimId;
    signedClaimHash.inputs[6] <== procedureCode;
    signedClaimHash.inputs[7] <== chainId;
    signedClaimHash.inputs[8] <== verifyingContract;

    component hospitalSignatureCheck = EdDSAPoseidonVerifier();
    hospitalSignatureCheck.enabled <== 1;
    hospitalSignatureCheck.Ax <== hospitalAx;
    hospitalSignatureCheck.Ay <== hospitalAy;
    hospitalSignatureCheck.S <== hospitalSignatureS;
    hospitalSignatureCheck.R8x <== hospitalSignatureR8x;
    hospitalSignatureCheck.R8y <== hospitalSignatureR8y;
    hospitalSignatureCheck.M <== signedClaimHash.out;

    // Require every rule check to pass. If any check fails, no proof can be made.
    // (No "valid" output: it would always be 1 and only shift the public signal order.)
    startPassed.out === 1;
    expiryNotReached.out === 1;
    dateNotInFuture.out === 1;
    amountWithinLimit.out === 1;
    amountIsPositive.out === 1;
}

component main {public [approvedHospitalRoot, policyCommitment, claimNullifier, claimAmount, hospitalPayoutAddress, claimSubmissionTime, chainId, verifyingContract]} = Claim(8, 5);
