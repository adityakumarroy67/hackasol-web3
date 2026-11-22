// Tests for lib/records.js (encryption, key sharing, content IDs). Run: npm run test:records
// Works on any laptop (no blockchain needed). Fictional data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import * as R from "./records.js";

const sample = R.fhirRecord({
  patientRef: "p-aarav", patientName: "Aarav (fictional)", condition: "Acute appendicitis",
  procedureCode: 4401, procedureName: "Appendectomy", date: "2026-11-21", medications: ["Amoxicillin 500 mg"],
});
const wallets = [1, 2, 3].map((i) => new Wallet("0x" + String(i).padStart(64, "0")));

test("content IDs match real IPFS (known values for '' and 'hello world')", async () => {
  assert.equal(await R.cidOf(new Uint8Array()), "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
  assert.equal(await R.cidOf(new TextEncoder().encode("hello world")), "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
});

test("lock and unlock a record; the locked file contains no readable medical text", async () => {
  const { ciphertext, key } = await R.encryptRecord(sample);
  assert.deepEqual(await R.decryptRecord(ciphertext, key), sample);
  const asText = new TextDecoder().decode(ciphertext);
  for (const word of ["appendicitis", "Appendectomy", "Amoxicillin", "Aarav"]) assert.ok(!asText.includes(word), `"${word}" readable`);
});

test("wrong key or a modified file cannot be unlocked", async () => {
  const { ciphertext, key } = await R.encryptRecord(sample);
  const wrongKey = key.slice(); wrongKey[0] ^= 1;
  await assert.rejects(R.decryptRecord(ciphertext, wrongKey));
  const modified = ciphertext.slice(); modified[20] ^= 1;
  await assert.rejects(R.decryptRecord(modified, key));
});

test("same wallet always re-creates the same personal key; different wallets get different keys", async () => {
  const a1 = await R.deriveKeys(wallets[0]);
  const a2 = await R.deriveKeys(wallets[0]);
  const b = await R.deriveKeys(wallets[1]);
  assert.deepEqual(a1.publicKey, a2.publicKey);
  assert.notDeepEqual(a1.publicKey, b.publicKey);
  assert.equal(a1.publicKey.length, 32);
});

test("a key shared with one person opens only for that person", async () => {
  const [patient, doctor, stranger] = await Promise.all(wallets.map(R.deriveKeys));
  const { ciphertext, key } = await R.encryptRecord(sample);
  const forDoctor = await R.wrapKey(key, doctor.publicKey);
  assert.equal(forDoctor.length, 92);
  assert.deepEqual(await R.unwrapKey(forDoctor, doctor), key);
  assert.deepEqual(await R.decryptRecord(ciphertext, await R.unwrapKey(forDoctor, doctor)), sample);
  await assert.rejects(R.unwrapKey(forDoctor, stranger));
  await assert.rejects(R.unwrapKey(forDoctor, patient));
  const tampered = forDoctor.slice(); tampered[60] ^= 1;
  await assert.rejects(R.unwrapKey(tampered, doctor));
});

const IPFS_API = process.env.IPFS_API;
test("real IPFS node: same content IDs as ours, files round-trip, missing files are reported",
  { skip: IPFS_API ? false : "no IPFS node — run inside Docker (docker compose run --rm dev npm run test:records)" }, async () => {
    const store = R.ipfsStore(IPFS_API);
    const { ciphertext } = await R.encryptRecord(sample);
    const cid = await store.put(ciphertext);
    assert.equal(cid, await R.cidOf(ciphertext));
    assert.deepEqual(await store.get(cid), ciphertext);
    const neverStored = await R.cidOf(new TextEncoder().encode(`never stored ${Date.now()}`));
    await assert.rejects(store.get(neverStored));
  });

test("storage: files come back unchanged; modified or missing files are rejected", async () => {
  const store = R.memoryStore();
  const { ciphertext } = await R.encryptRecord(sample);
  const cid = await store.put(ciphertext);
  assert.deepEqual(await store.get(cid), ciphertext);
  const swapped = ciphertext.slice(); swapped[30] ^= 1;
  store.files.set(cid, swapped);
  await assert.rejects(store.get(cid), /modified/);
  await assert.rejects(store.get("bafkreinotthere"), /not found/);
});
