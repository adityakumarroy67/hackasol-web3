// HealthRecords contract + encryption, end to end on a local test chain.
// Run (in WSL on this laptop): npm test. Fictional data only.
import { expect } from "chai";
import { network } from "hardhat";
import * as R from "../lib/records.js";

const { ethers, networkHelpers } = await network.create();
const HOUR = 3600n;

describe("HealthRecords: encrypted records with patient-controlled access", () => {
  async function setup() {
    const [patient, hospital, doctor, stranger] = await ethers.getSigners();
    const healthRecords = await ethers.deployContract("HealthRecords");
    const store = R.memoryStore();

    // Everyone "unlocks" once: derive personal keys from a wallet signature, publish the public key.
    const keys = { patient: await R.deriveKeys(patient), doctor: await R.deriveKeys(doctor), stranger: await R.deriveKeys(stranger) };
    for (const [who, signer] of [["patient", patient], ["doctor", doctor], ["stranger", stranger]] as const) {
      await healthRecords.connect(signer).setEncryptionKey(R.bytesToHex(keys[who].publicKey));
    }

    // Hospital writes the record, locks it, stores the locked file, and adds it to the patient's locker.
    const record = R.fhirRecord({
      patientRef: "p-aarav", patientName: "Aarav (fictional)", condition: "Acute appendicitis",
      procedureCode: 4401, procedureName: "Appendectomy", date: "2026-11-21", medications: ["Amoxicillin 500 mg"],
    });
    const { ciphertext, key } = await R.encryptRecord(record);
    const cid = await store.put(ciphertext);
    const patientPublicKey = R.hexToBytes(await healthRecords.encryptionKey(patient));
    await healthRecords.connect(patient).setRecordWriter(hospital, true); // the patient lets this hospital write
    await healthRecords.connect(hospital).addRecord(patient, cid, R.bytesToHex(await R.wrapKey(key, patientPublicKey)));
    const id = 0n;

    // What a user's app does to open a record.
    async function open(user: any, userKeys: any) {
      const onChain = await healthRecords.records(id);
      const recordKey = await R.unwrapKey(R.hexToBytes(await healthRecords.keyFor(id, user)), userKeys);
      return R.decryptRecord(await store.get(onChain.cid), recordKey);
    }
    // Patient shares the record key with a grantee (re-wrapped for the grantee's public key).
    async function share(grantee: any, expiresAt: bigint) {
      const recordKey = await R.unwrapKey(R.hexToBytes(await healthRecords.keyFor(id, patient)), keys.patient);
      const granteePublicKey = R.hexToBytes(await healthRecords.encryptionKey(grantee));
      return healthRecords.connect(patient).grantAccess(id, grantee, R.bytesToHex(await R.wrapKey(recordKey, granteePublicKey)), expiresAt);
    }
    const now = async () => BigInt(await networkHelpers.time.latest());
    return { patient, hospital, doctor, stranger, healthRecords, store, keys, record, cid, ciphertext, id, open, share, now };
  }

  it("hospital adds an encrypted record: only the fingerprint (CID) goes on-chain; the patient can open it", async () => {
    const { patient, hospital, healthRecords, keys, record, cid, ciphertext, id, open } = await setup();
    const onChain = await healthRecords.records(id);
    expect(onChain.patient).to.equal(patient.address);
    expect(onChain.issuer).to.equal(hospital.address);
    expect(onChain.cid).to.equal(cid);
    expect(await healthRecords.recordsOf(patient)).to.deep.equal([0n]);
    expect(new TextDecoder().decode(ciphertext)).to.not.include("appendicitis");
    expect(await open(patient, keys.patient)).to.deep.equal(record);
  });

  it("patient grants a doctor 7-day access; the doctor opens it and the view is logged on-chain", async () => {
    const { doctor, healthRecords, keys, record, id, open, share, now } = await setup();
    await expect(share(doctor, (await now()) + 7n * 24n * HOUR)).to.emit(healthRecords, "AccessGranted");
    expect(await healthRecords.hasAccess(id, doctor)).to.equal(true);
    expect(await open(doctor, keys.doctor)).to.deep.equal(record);
    await expect(healthRecords.connect(doctor).logView(id)).to.emit(healthRecords, "RecordViewed").withArgs(id, doctor.address);
  });

  it("time-limited access ends automatically", async () => {
    const { doctor, healthRecords, id, share, now } = await setup();
    await share(doctor, (await now()) + HOUR);
    await networkHelpers.time.increase(Number(HOUR) + 1);
    expect(await healthRecords.hasAccess(id, doctor)).to.equal(false);
    await expect(healthRecords.keyFor(id, doctor)).to.be.revertedWithCustomError(healthRecords, "NoAccess");
    await expect(healthRecords.connect(doctor).logView(id)).to.be.revertedWithCustomError(healthRecords, "NoAccess");
  });

  it("patient revokes access: the doctor's key is removed and the system refuses further access", async () => {
    const { patient, doctor, healthRecords, id, share } = await setup();
    await share(doctor, 0n);
    await expect(healthRecords.connect(patient).revokeAccess(id, doctor)).to.emit(healthRecords, "AccessRevoked");
    expect(await healthRecords.hasAccess(id, doctor)).to.equal(false);
    await expect(healthRecords.keyFor(id, doctor)).to.be.revertedWithCustomError(healthRecords, "NoAccess");
    await expect(healthRecords.connect(doctor).logView(id)).to.be.revertedWithCustomError(healthRecords, "NoAccess");
  });

  it("only the patient can grant or revoke; the patient can't lock themselves out", async () => {
    const { patient, hospital, stranger, healthRecords, id } = await setup();
    await expect(healthRecords.connect(hospital).grantAccess(id, stranger, "0x01", 0)).to.be.revertedWithCustomError(healthRecords, "NotPatient");
    await expect(healthRecords.connect(stranger).revokeAccess(id, patient)).to.be.revertedWithCustomError(healthRecords, "NotPatient");
    await expect(healthRecords.connect(patient).revokeAccess(id, patient)).to.be.revertedWithCustomError(healthRecords, "CannotRevokePatient");
    await expect(healthRecords.connect(patient).grantAccess(99, stranger, "0x01", 0)).to.be.revertedWithCustomError(healthRecords, "UnknownRecord");
  });

  it("only hospitals the patient allowed can add records, and the patient can take that back", async () => {
    const { patient, hospital, stranger, healthRecords } = await setup();
    await expect(healthRecords.connect(stranger).addRecord(patient, "bafyfake", "0x01")).to.be.revertedWithCustomError(healthRecords, "NotAllowedToAdd");
    await expect(healthRecords.connect(hospital).addRecord(patient, "bafysecond", "0x01")).to.emit(healthRecords, "RecordAdded");
    await expect(healthRecords.connect(patient).setRecordWriter(hospital, false)).to.emit(healthRecords, "RecordWriterSet").withArgs(patient.address, hospital.address, false);
    await expect(healthRecords.connect(hospital).addRecord(patient, "bafythird", "0x01")).to.be.revertedWithCustomError(healthRecords, "NotAllowedToAdd");
    expect(await healthRecords.recordsOf(patient)).to.deep.equal([0n, 1n]);
  });

  it("someone without access learns nothing, even though all on-chain data is public", async () => {
    const { patient, stranger, healthRecords, keys, store, id } = await setup();
    await expect(healthRecords.keyFor(id, stranger)).to.be.revertedWithCustomError(healthRecords, "NoAccess");
    // The stranger CAN read the patient's wrapped key (blockchains are public) and the locked file...
    const patientsWrappedKey = R.hexToBytes(await healthRecords.keyFor(id, patient));
    const lockedFile = await store.get((await healthRecords.records(id)).cid);
    expect(lockedFile.length).to.be.greaterThan(0);
    // ...but without the patient's private key, it can't be unlocked.
    let opened = true;
    try { await R.unwrapKey(patientsWrappedKey, keys.stranger); } catch { opened = false; }
    expect(opened).to.equal(false);
  });

  it("the access history can be rebuilt from on-chain events", async () => {
    const { patient, doctor, healthRecords, id, share } = await setup();
    await share(doctor, 0n);
    await healthRecords.connect(doctor).logView(id);
    await healthRecords.connect(patient).revokeAccess(id, doctor);
    const history = (await healthRecords.queryFilter("*" as any))
      .filter((e: any) => e.args?.recordId === id && e.fragment?.name !== "RecordAdded")
      .map((e: any) => e.fragment.name);
    expect(history).to.deep.equal(["AccessGranted", "RecordViewed", "AccessRevoked"]);
  });

  it("a modified file in storage is detected before decryption", async () => {
    const { store, cid, ciphertext } = await setup();
    const swapped = ciphertext.slice(); swapped[25] ^= 1;
    store.files.set(cid, swapped);
    let error = "";
    try { await store.get(cid); } catch (e: any) { error = e.message; }
    expect(error).to.include("modified");
  });
});
