import { expect } from "chai";
import { network } from "hardhat";
import { prove, scenario, toCalldata } from "./fixture.js";

const { ethers, networkHelpers } = await network.create();

describe("M2 InsureTrust contract", () => {
  after(() => (globalThis as any).curve_bn128?.terminate());

  async function deploy() {
    const [insurer, patient, hospitalPayout, stranger, doctor] = await ethers.getSigners();
    const s = await scenario();
    const token = await ethers.deployContract("TestINR");
    const verifier = await ethers.deployContract("ClaimVerifier");
    const it = await ethers.deployContract("InsureTrust", [verifier, token, s.hospitalTree.root]);
    await token.mint(it, ethers.parseEther("1000000")); // ₹10 lakh test pool

    const rc = s.Z.recordCommitment(s.record);
    await it.registerPolicy(s.Z.policyCommitment(s.policy), patient);
    await it.connect(patient).registerRecord(rc, "bafy-test-cid");

    const now = BigInt(await networkHelpers.time.latest());
    const contractAddress = await it.getAddress();
    const claimInput = (over: Record<string, any> = {}) =>
      s.input({ claimDate: now - 60n, recipient: hospitalPayout.address, verifyingContract: contractAddress, ...over });
    const proofFor = async (over: Record<string, any> = {}) => {
      const { proof, publicSignals } = await prove(await claimInput(over));
      return toCalldata(proof, publicSignals);
    };
    return { s, token, it, rc, insurer, patient, hospitalPayout, stranger, doctor, proofFor };
  }

  it("valid claim pays the recipient and records the claim", async () => {
    const { token, it, patient, hospitalPayout, proofFor } = await deploy();
    const [a, b, c, pub] = await proofFor();
    await expect(it.connect(patient).submitClaim(a, b, c, pub)).to.emit(it, "ClaimSettled");
    expect(await token.balanceOf(hospitalPayout)).to.equal(4_200_000n * 10n ** 16n); // ₹42,000 tINR
    expect(await it.claimCount()).to.equal(1n);
  });

  it("duplicate claim (same nullifier) reverts", async () => {
    const { it, patient, proofFor } = await deploy();
    const [a, b, c, pub] = await proofFor();
    await it.connect(patient).submitClaim(a, b, c, pub);
    await expect(it.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(it, "NullifierUsed");
  });

  it("tampered recipient (front-running) reverts", async () => {
    const { it, patient, stranger, proofFor } = await deploy();
    const [a, b, c, pub] = await proofFor();
    const stolen = [...pub]; stolen[6] = BigInt(stranger.address);
    await expect(it.connect(patient).submitClaim(a, b, c, stolen)).to.be.revertedWithCustomError(it, "InvalidProof");
  });

  it("tampered amount reverts", async () => {
    const { it, patient, proofFor } = await deploy();
    const [a, b, c, pub] = await proofFor();
    const bumped = [...pub]; bumped[3] = BigInt(pub[3]) + 1n;
    await expect(it.connect(patient).submitClaim(a, b, c, bumped)).to.be.revertedWithCustomError(it, "InvalidProof");
  });

  it("proof made for another contract reverts", async () => {
    const { it, patient, proofFor } = await deploy();
    const [a, b, c, pub] = await proofFor({ verifyingContract: "0x" + "33".repeat(20) });
    await expect(it.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(it, "WrongChainOrContract");
  });

  it("de-listed hospital (root updated) reverts", async () => {
    const { s, it, patient, proofFor } = await deploy();
    const [a, b, c, pub] = await proofFor();
    await it.setHospitalRoot(s.Z.merkleTree([s.hospitals[0].leaf], s.Z.HOSPITAL_DEPTH).root);
    await expect(it.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(it, "UnknownRoot");
  });

  it("only the policyholder can submit; revoked policy reverts", async () => {
    const { s, it, patient, stranger, proofFor } = await deploy();
    const [a, b, c, pub] = await proofFor();
    await expect(it.connect(stranger).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(it, "NotPolicyHolder");
    await it.revokePolicy(s.Z.policyCommitment(s.policy));
    await expect(it.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(it, "NotPolicyHolder");
  });

  it("future-dated or stale claim date reverts", async () => {
    const { it, patient, proofFor } = await deploy();
    const now = BigInt(await networkHelpers.time.latest());
    let [a, b, c, pub] = await proofFor({ claimDate: now + 3600n });
    await expect(it.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(it, "BadClaimDate");
    [a, b, c, pub] = await proofFor({ claimDate: now - 31n * 86400n });
    await expect(it.connect(patient).submitClaim(a, b, c, pub)).to.be.revertedWithCustomError(it, "BadClaimDate");
  });

  it("only the insurer manages roots and policies", async () => {
    const { it, stranger } = await deploy();
    await expect(it.connect(stranger).setHospitalRoot(1n)).to.be.revertedWithCustomError(it, "NotInsurer");
    await expect(it.connect(stranger).registerPolicy(1n, stranger)).to.be.revertedWithCustomError(it, "NotInsurer");
  });

  it("patient grants, expires and revokes doctor access; views are logged", async () => {
    const { it, rc, patient, doctor, stranger } = await deploy();
    await expect(it.connect(stranger).grantAccess(rc, doctor, "0x01", 0)).to.be.revertedWithCustomError(it, "NotRecordOwner");

    const expires = BigInt(await networkHelpers.time.latest()) + 3600n;
    await it.connect(patient).grantAccess(rc, doctor, "0xabcd", expires);
    expect(await it.hasAccess(rc, doctor)).to.equal(true);
    expect((await it.getGrant(rc, doctor))[0]).to.equal("0xabcd");
    await expect(it.connect(doctor).logView(rc)).to.emit(it, "RecordViewed");

    await networkHelpers.time.increase(3601);
    expect(await it.hasAccess(rc, doctor)).to.equal(false);

    await it.connect(patient).grantAccess(rc, doctor, "0xabcd", 0);
    await it.connect(patient).revokeAccess(rc, doctor);
    expect(await it.hasAccess(rc, doctor)).to.equal(false);
    await expect(it.connect(doctor).logView(rc)).to.be.revertedWithCustomError(it, "NoAccess");
  });

  it("a record can't be registered twice", async () => {
    const { it, rc, stranger } = await deploy();
    await expect(it.connect(stranger).registerRecord(rc, "x")).to.be.revertedWithCustomError(it, "RecordExists");
  });
});
