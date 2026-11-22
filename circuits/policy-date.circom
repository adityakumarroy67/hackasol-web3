pragma circom 2.2.0;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

template PolicyDateWindow() {
    // These dates are private inputs.
    signal input policyStart;
    signal input claimDate;
    signal input policyExpiry;

    // The proof exposes only whether the date check passed.
    signal output valid;

    // Require each date to be an unsigned 64-bit number.
    component startBits = Num2Bits(64);
    component claimBits = Num2Bits(64);
    component expiryBits = Num2Bits(64);

    startBits.in <== policyStart;
    claimBits.in <== claimDate;
    expiryBits.in <== policyExpiry;

    // Check: policyStart <= claimDate
    component startPassed = LessEqThan(64);
    startPassed.in[0] <== policyStart;
    startPassed.in[1] <== claimDate;

    // Check: claimDate < policyExpiry
    component expiryNotReached = LessThan(64);
    expiryNotReached.in[0] <== claimDate;
    expiryNotReached.in[1] <== policyExpiry;

    valid <== startPassed.out * expiryNotReached.out;
    valid === 1;
}

component main = PolicyDateWindow();