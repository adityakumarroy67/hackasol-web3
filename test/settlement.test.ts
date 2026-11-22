// Contract tests: real proofs submitted to InsureTrust on a local test chain.
// Run (in WSL on this laptop): npm test     — needs `npm run circuit claim` first. Fictional data only.
import { expect } from "chai";
import { network } from "hardhat";
import * as C from "../lib/claim.js";

const { ethers, networkHelpers } = await network.create();
const WASM = "circuits/build/claim_js/claim.wasm";
const ZKEY = "circuits/build/claim.zkey";
const DAY = 86_400n;

describe("InsureTrust settlement contract", () => {
  after(() => (globalThis as any).curve_bn128?.terminate()); // let mocha exit after proving

  async function setup({ pool = 100_000_000n } = {}) {
    await C.init();
    const [insurer, patient, hospitalWallet, otherHospitalWallet, stranger] = await ethers.getSigners();
    const hospital = C.makeHospital(new Uint8Array(32).fill(1), hospitalWallet.address);
    const otherHospital = C.makeHospital(new Uint8Array(32).fill(2), otherHospitalWallet.address);
    const hospitals = [hospital, otherHospital];
    const hospitalRoot = C.merkleTree(hospitals.map((h) => h.leaf), C.HOSPITAL_DEPTH).root;

    const now = BigInt(await networkHelpers.time.latest());
    const policy = C.makePolicy({
      policyId: 7001n, policyStart: now - 30n * DAY, policyExpiry: now + 335n * DAY,
      policyLimit: 5_000_000n, // ₹50,000 in paise
      policySalt: C.randomSecret(), coveredProcedures: [4401n, 4402n, 5001n],
    });

    const token = await ethers.deployContract("TestINR");
    const verifier = await ethers.deployContract("ClaimVerifier");
    const insureTrust = await ethers.deployContract("InsureTrust", [verifier, token, hospitalRoot]);
    await token.mint(insureTrust, pool); // default ₹10 lakh test pool
    await insureTrust.registerPolicy(policy.commitment, patient);
    const contractAddress = await insureTrust.getAddress();

    // The hospital makes a proof for a claim (defaults = a valid ₹42,000 claim).
    async function hospitalProof(over: Record<string, any> = {}) {
      const input = C.buildClaim({
        hospital, hospitals, policy, claimId: 880001n, procedureCode: 4402n,
        claimDate: now - 2n * DAY, claimAmount: 4_200_000n, claimSubmissionTime: now - 60n,
        chainId: 31337n, verifyingContract: contractAddress, ...over,
      });
      const { proof, publicSignals } = await C.proveClaim(input, WASM, ZKEY);
      return C.toCalldata(proof, publicSignals);
    }
    return { insurer, patient, hospitalWallet, stranger, hospitals, policy, token, insureTrust, now, hospitalProof };
  }

  it("valid claim: patient submits, hospital is paid ₹42,000 tINR automatically", async () => {
    const { patient, hospitalWallet, token, insureTrust, hospitalProof } = await setup();
    const [a, b, c, pub] = await hospitalProof();
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.emit(insureTrust, "ClaimSettled");
    expect(await token.balanceOf(hospitalWallet)).to.equal(4_200_000n);
    expect(await insureTrust.claimCount()).to.equal(1n);
    const saved = await insureTrust.claims(0);
    expect(saved.amount).to.equal(4_200_000n); // insurer sees amount + payout, no medical data
    expect(saved.hospitalPayout).to.equal(hospitalWallet.address);
  });

  it("same claim submitted twice: second one is rejected (no double payment)", async () => {
    const { patient, token, hospitalWallet, insureTrust, hospitalProof } = await setup();
    const [a, b, c, pub] = await hospitalProof();
    await insureTrust.connect(patient).submitClaim(a, b, c, pub);
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "AlreadyPaid");
    expect(await token.balanceOf(hospitalWallet)).to.equal(4_200_000n); // paid only once
  });

  it("issue #4: only the policyholder (patient) can submit", async () => {
    const { stranger, hospitalWallet, insureTrust, hospitalProof } = await setup();
    const [a, b, c, pub] = await hospitalProof();
    await expect(insureTrust.connect(stranger).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "NotPolicyHolder");
    // even the hospital itself can't submit without the patient
    await expect(insureTrust.connect(hospitalWallet).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "NotPolicyHolder");
  });

  it("issue #5: proof older than 1 day is rejected; future submission time is rejected", async () => {
    const { patient, insureTrust, now, hospitalProof } = await setup();
    let [a, b, c, pub] = await hospitalProof({ claimDate: now - 3n * DAY, claimSubmissionTime: now - 2n * DAY });
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "BadSubmissionTime");
    [a, b, c, pub] = await hospitalProof({ claimSubmissionTime: now + 3600n });
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "BadSubmissionTime");
  });

  it("revoked or unregistered policy is rejected", async () => {
    const { patient, policy, insureTrust, hospitalProof } = await setup();
    const [a, b, c, pub] = await hospitalProof();
    await insureTrust.revokePolicy(policy.commitment);
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "NotPolicyHolder");
  });

  it("hospital removed from the approved list is rejected", async () => {
    const { patient, hospitals, insureTrust, hospitalProof } = await setup();
    const [a, b, c, pub] = await hospitalProof();
    await insureTrust.setHospitalRoot(C.merkleTree([hospitals[1].leaf], C.HOSPITAL_DEPTH).root); // remove hospital 0
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "UnknownHospitalRoot");
  });

  it("proof made for a different contract is rejected", async () => {
    const { patient, insureTrust, hospitalProof } = await setup();
    const [a, b, c, pub] = await hospitalProof({ verifyingContract: "0x" + "33".repeat(20) });
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(insureTrust, "WrongDeployment");
  });

  it("changing the amount or payout wallet in a real proof is rejected", async () => {
    const { patient, stranger, insureTrust, hospitalProof } = await setup();
    const [a, b, c, pub] = await hospitalProof();
    const moreMoney = [...pub]; moreMoney[3] = 4_900_000n;
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, moreMoney)).to.be.revertedWithCustomError(insureTrust, "InvalidProof");
    const stolen = [...pub]; stolen[4] = BigInt(stranger.address);
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, stolen)).to.be.revertedWithCustomError(insureTrust, "InvalidProof");
  });

  it("only the insurer can change the hospital list or register policies", async () => {
    const { stranger, insureTrust } = await setup();
    await expect(insureTrust.connect(stranger).setHospitalRoot(1n)).to.be.revertedWithCustomError(insureTrust, "NotInsurer");
    await expect(insureTrust.connect(stranger).registerPolicy(1n, stranger)).to.be.revertedWithCustomError(insureTrust, "NotInsurer");
  });

  it("pool too small: nothing is paid or marked used, and the claim works after a top-up", async () => {
    const { patient, token, insureTrust, hospitalProof, hospitalWallet } = await setup({ pool: 1_000_000n }); // only ₹10,000
    const [a, b, c, pub] = await hospitalProof(); // ₹42,000
    await expect(insureTrust.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    expect(await insureTrust.nullifierUsed(pub[2])).to.equal(false);

    await token.mint(insureTrust, 10_000_000n); // insurer tops up the pool
    await insureTrust.connect(patient).submitClaim(a, b, c, pub);
    expect(await token.balanceOf(hospitalWallet)).to.equal(4_200_000n);
  });
});
