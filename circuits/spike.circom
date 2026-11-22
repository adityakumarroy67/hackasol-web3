pragma circom 2.2.0;

// S1 spike: prove knowledge of a Poseidon preimage. Validates the whole toolchain.
include "circomlib/circuits/poseidon.circom";

template Spike() {
    signal input secret;
    signal input hash;
    signal h <== Poseidon(1)([secret]);
    hash === h;
}

component main {public [hash]} = Spike();
