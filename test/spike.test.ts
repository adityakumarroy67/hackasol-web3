import { expect } from "chai";
import { network } from "hardhat";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";

const { ethers } = await network.create();

// snarkjs proof -> [a, b, c, publicSignals] in the verifier's argument format
export async function toCalldata(proof: any, publicSignals: string[]) {
  return JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
}

describe("S1 spike: Poseidon preimage, JS -> circuit -> Solidity", () => {
  after(() => (globalThis as any).curve_bn128?.terminate()); // snarkjs workers keep mocha alive

  it("verifies a real proof and rejects a tampered public signal", async () => {
    const poseidon = await buildPoseidon();
    const secret = 123456789n;
    const hash = poseidon.F.toObject(poseidon([secret])); // JS hash must equal circuit hash (S2 parity)

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { secret, hash },
      "circuits/build/spike_js/spike.wasm",
      "circuits/build/spike.zkey",
    );
    const verifier = await ethers.deployContract("SpikeVerifier");
    const [a, b, c, pub] = await toCalldata(proof, publicSignals);

    expect(await verifier.verifyProof(a, b, c, pub)).to.equal(true);
    expect(await verifier.verifyProof(a, b, c, [BigInt(pub[0]) + 1n])).to.equal(false);
  });

  it("cannot prove with the wrong secret", async () => {
    const poseidon = await buildPoseidon();
    const hash = poseidon.F.toObject(poseidon([1n]));
    await expect(
      snarkjs.groth16.fullProve({ secret: 2n, hash }, "circuits/build/spike_js/spike.wasm", "circuits/build/spike.zkey"),
    ).to.be.rejected;
  });
});
