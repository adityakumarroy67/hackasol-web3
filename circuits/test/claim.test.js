// Circuit tests: one valid claim, then one test per way of cheating.
// Run: npm run test:circuit   (uses the committed proof files in app/public/zk, the ones deployed)
// All data is fictional.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../../lib/claim.js";

const WASM = "app/public/zk/claim.wasm";
const ZKEY = "app/public/zk/claim.zkey";
const vkey = JSON.parse(readFileSync("app/public/zk/claim_vkey.json", "utf8"));
const day = (y, m, d) => BigInt(Date.UTC(y, m - 1, d) / 1000); // UTC Unix seconds

after(() => globalThis.curve_bn128?.terminate()); // let the process exit after proving

// ---------- fictional scenario ----------
const hospitalA = await C.makeHospital(new Uint8Array(32).fill(1), "0x" + "a1".repeat(20));
const hospitalB = await C.makeHospital(new Uint8Array(32).fill(2), "0x" + "b2".repeat(20));
const outsider = await C.makeHospital(new Uint8Array(32).fill(9), "0x" + "99".repeat(20)); // NOT approved
const hospitals = [hospitalA, hospitalB];

const policy = C.makePolicy({
  policyId: 7001n,
  policyStart: day(2026, 1, 1),
  policyExpiry: day(2027, 1, 1), // expiry day itself is NOT covered
  policyLimit: 5_000_000n, // ₹50,000 in paise
  policySalt: 0x5a17n * 10n ** 30n + 12345n,
  coveredProcedures: [4401n, 4402n, 5001n], // e.g. appendectomy, cataract, angioplasty
});

const valid = {
  hospital: hospitalB, hospitals, policy,
  claimId: 880001n,
  procedureCode: 4402n,
  claimDate: day(2026, 11, 20),
  claimAmount: 4_200_000n, // ₹42,000 in paise
  claimSubmissionTime: day(2026, 11, 23),
  chainId: 31337n,
  verifyingContract: "0x" + "c0".repeat(20),
};
const claim = (over = {}) => C.buildClaim({ ...valid, ...over });
const prove = async (input) => C.proveClaim(await input, WASM, ZKEY);
const rejects = async (input) => assert.rejects(prove(await input), "a proof was created for an invalid claim");

// ---------- valid claims ----------
test("valid claim: proof is created and verifies", async () => {
  const input = await claim();
  const { proof, publicSignals } = await prove(input);
  assert.equal(await C.verifyClaim(vkey, publicSignals, proof), true);

  // the 8 public values are exactly what we expect, in order
  assert.deepEqual(publicSignals.map(BigInt), C.PUBLIC_SIGNALS.map((k) => input[k]));

  // private details never appear in the public values
  for (const secret of [valid.procedureCode, valid.claimDate, valid.claimId, policy.policyLimit, policy.policyExpiry]) {
    assert.ok(!publicSignals.map(BigInt).includes(secret), `private value ${secret} leaked`);
  }
});

test("valid edge cases: claim on the policy start day, amount exactly at the limit", async () => {
  await prove(claim({ claimDate: policy.policyStart }));
  await prove(claim({ claimAmount: policy.policyLimit }));
});

test("changing a public value after proving makes verification fail", async () => {
  const { proof, publicSignals } = await prove(claim());
  const tampered = [...publicSignals];
  tampered[3] = (BigInt(tampered[3]) + 1n).toString(); // amount +1 paise
  assert.equal(await C.verifyClaim(vkey, tampered, proof), false);
});

// ---------- policy rules ----------
test("rejected: claim date on or after policy expiry", () => rejects(claim({ claimDate: policy.policyExpiry, claimSubmissionTime: policy.policyExpiry })));
test("rejected: claim date before policy start", () => rejects(claim({ claimDate: day(2025, 12, 31) })));
test("rejected: claim date after the submission time (future-dated)", () => rejects(claim({ claimDate: day(2026, 11, 24) })));
test("rejected: procedure not covered by the policy", () => rejects(claim({ procedureCode: 9999n })));
test("rejected: amount above the policy limit", () => rejects(claim({ claimAmount: policy.policyLimit + 1n })));
test("rejected: zero amount", () => rejects(claim({ claimAmount: 0n })));
test("rejected: oversized amounts (number wrap-around tricks)", async () => {
  const FIELD = 21888242871839275222246405745257275088548364400416422507208166427275222245617n;
  await rejects(claim({ claimAmount: 1n << 128n }));
  await rejects(claim({ claimAmount: FIELD - 1n })); // acts like "-1" in circuit math
});
test("rejected: policy terms don't match the registered fingerprint", async () => {
  return rejects({ ...(await claim()), policyLimit: 99_000_000n }); // secretly raise the limit
});

// ---------- hospital rules ----------
test("rejected: hospital not on the approved list", () => rejects(claim({ hospital: outsider })));
test("rejected: payout address swapped to someone else's wallet", async () =>
  rejects({ ...(await claim()), hospitalPayoutAddress: BigInt("0x" + "ee".repeat(20)) }));
test("rejected: claim signed by a different hospital", () => rejects(claim({ signer: hospitalA })));
test("rejected: amount changed after the hospital signed", async () => {
  const input = await claim(); // hospital signed ₹42,000
  return rejects({ ...input, claimAmount: 4_900_000n }); // someone tries to claim ₹49,000
});
test("rejected: tampered hospital-list proof (changed neighbour / invalid direction bit)", async () => {
  const input = await claim();
  const path = [...input.hospitalPath]; path[0] += 1n;
  await rejects({ ...input, hospitalPath: path });
  const bits = [...input.hospitalPathIndices]; bits[0] = 2;
  await rejects({ ...input, hospitalPathIndices: bits });
});

// ---------- one-time claim code ----------
test("rejected: forged one-time claim code (nullifier)", async () => rejects({ ...(await claim()), claimNullifier: 123n }));
test("same claim ID always gives the same one-time code (so the contract can block repeats)", async () => {
  assert.equal((await claim()).claimNullifier, (await claim()).claimNullifier);
  assert.notEqual((await claim()).claimNullifier, (await claim({ claimId: 880002n })).claimNullifier);
});

test("same bill always gets the same claim ID, so a retried proof can't be paid twice", async () => {
  const id = await C.stableClaimId("0xhospital", "bill:INV-0001");
  assert.equal(id, await C.stableClaimId("0xhospital", "bill:INV-0001"));
  assert.notEqual(id, await C.stableClaimId("0xhospital", "bill:INV-0002"));
  assert.notEqual(id, await C.stableClaimId("0xother", "bill:INV-0001"));
  assert.ok(id < 2n ** 120n); // the circuit accepts claim IDs up to 128 bits
  assert.equal((await claim({ claimId: id })).claimNullifier, (await claim({ claimId: id })).claimNullifier);
});

// ---------- plain-language reasons (shown on the website before proving) ----------
test("claimProblems explains each broken rule in plain words", () => {
  const base = { hospital: hospitalB, hospitals, policy, procedureCode: 4402n, claimDate: day(2026, 11, 20), claimAmount: 4_200_000n, claimSubmissionTime: day(2026, 11, 23) };
  assert.deepEqual(C.claimProblems(base), []);
  assert.match(C.claimProblems({ ...base, hospital: outsider })[0], /not on the insurer's approved list/);
  assert.match(C.claimProblems({ ...base, claimDate: policy.policyExpiry, claimSubmissionTime: policy.policyExpiry })[0], /expired/);
  assert.match(C.claimProblems({ ...base, procedureCode: 9999n })[0], /not covered/);
  assert.match(C.claimProblems({ ...base, claimAmount: policy.policyLimit + 1n })[0], /above the policy limit/);
});

test("big-number JSON round-trip keeps policy files exact", () => {
  assert.deepEqual(C.fromJson(C.toJson(policy)), policy);
});
