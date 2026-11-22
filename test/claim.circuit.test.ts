import { expect } from "chai";
import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { prove, scenario } from "./fixture.js";

describe("M1 claim circuit", () => {
  after(() => (globalThis as any).curve_bn128?.terminate()); // snarkjs workers keep mocha alive

  it("valid claim: proves and verifies off-chain", async () => {
    const s = await scenario();
    const { proof, publicSignals } = await prove(s.input());
    const vkey = JSON.parse(readFileSync("circuits/build/claim_vkey.json", "utf8"));
    expect(await snarkjs.groth16.verify(vkey, publicSignals, proof)).to.equal(true);
    // public signals expose no diagnosis / procedure
    expect(publicSignals.map(BigInt)).to.not.include(s.record.diagnosisCode);
    expect(publicSignals.map(BigInt)).to.not.include(s.record.procedureCode);
  });

  it("hospital not on the approved list", async () => {
    const s = await scenario();
    const rc = s.Z.recordCommitment(s.record);
    const bad = s.input({ hospital: s.outsider, signature: s.Z.signRecord(s.outsider, rc) });
    await expect(prove(bad)).to.be.rejected;
  });

  it("record signed by a different hospital than the one proven", async () => {
    const s = await scenario();
    const sigByH0 = s.Z.signRecord(s.hospitals[0], s.Z.recordCommitment(s.record));
    await expect(prove(s.input({ signature: sigByH0 }))).to.be.rejected;
  });

  it("expired policy (claim date after expiry)", async () => {
    const s = await scenario({ claimDate: 1_950_000_000n });
    await expect(prove(s.input())).to.be.rejected;
  });

  it("claim before policy start", async () => {
    const s = await scenario({ claimDate: 1_600_000_000n });
    await expect(prove(s.input())).to.be.rejected;
  });

  it("uncovered procedure", async () => {
    const s = await scenario();
    const record = { ...s.record, procedureCode: 9999n };
    const signature = s.Z.signRecord(s.hospitals[1], s.Z.recordCommitment(record));
    await expect(prove(s.input({ record, signature }))).to.be.rejected;
  });

  it("amount over the policy limit", async () => {
    const s = await scenario();
    await expect(prove(s.input({ claimAmount: 5_000_001n }))).to.be.rejected;
  });

  it("oversized amount (field wrap-around attempt)", async () => {
    const s = await scenario();
    const p = 21888242871839275222246405745257275088548364400416422507208166427275222245617n;
    await expect(prove(s.input({ claimAmount: p - 1n }))).to.be.rejected;
    await expect(prove(s.input({ claimAmount: 1n << 64n }))).to.be.rejected;
  });

  it("tampered Merkle proof (sibling changed / non-binary direction bit)", async () => {
    const s = await scenario();
    const good = s.input();
    const path = [...good.hospitalPath]; path[0] += 1n;
    await expect(prove({ ...good, hospitalPath: path })).to.be.rejected;
    const idx = [...good.hospitalIdx]; idx[0] = 2;
    await expect(prove({ ...good, hospitalIdx: idx })).to.be.rejected;
  });

  it("record and policy belong to different patients", async () => {
    const s = await scenario();
    const policy = s.Z.makePolicy({ ...s.policy, patientId: 2002n });
    await expect(prove(s.input({ policy }))).to.be.rejected;
  });

  it("forged nullifier (not derived from the record)", async () => {
    const s = await scenario();
    await expect(prove({ ...s.input(), nullifier: 123n })).to.be.rejected;
  });
});
