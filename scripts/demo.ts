// End-to-end demo on a local test blockchain, with a written report.
// Run (in WSL on Windows laptops with the Hardhat block):  npx hardhat run scripts/demo.ts
// Uses the committed proof files in app/public/zk. ALL people, hospitals and money here are fictional / test-only.
import { network } from "hardhat";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as C from "../lib/claim.js";
import * as R from "../lib/records.js";

const { ethers, networkHelpers } = await network.create();
const WASM = "app/public/zk/claim.wasm";
const ZKEY = "app/public/zk/claim.zkey";
const DAY = 86_400n;
const rupees = (paise: bigint) => "₹" + (Number(paise) / 100).toLocaleString("en-IN");
const short = (x: string | bigint) => { const s = typeof x === "bigint" ? "0x" + x.toString(16) : x; return s.slice(0, 8) + "…" + s.slice(-4); };


// ---------- people & organisations (fictional) ----------
const [insurer, aarav, meera, kabir, ishita, sanjeevaniWallet, narmadaWallet, unlistedWallet, drRao, stranger] = await ethers.getSigners();

// Turn an error into a short reason: the contract's error name, or a plain explanation.
function reasonOf(e: any, contract: any) {
  if (e.revert?.name) return `Contract refused: ${e.revert.name}`;
  try {
    const parsed = contract.interface.parseError(e.data ?? e.error?.data ?? e.info?.error?.data);
    if (parsed) return `Contract refused: ${parsed.name}`;
  } catch {}
  if (e.name === "OperationError") return "Cannot unlock: the key was not made for this person";
  return e.shortMessage ?? e.message ?? "failed";
}
const sanjeevani = { name: "Sanjeevani Multispeciality (fictional)", ...(await C.makeHospital(new Uint8Array(32).fill(11), sanjeevaniWallet.address)) };
const narmada = { name: "Narmada Heart Institute (fictional)", ...(await C.makeHospital(new Uint8Array(32).fill(12), narmadaWallet.address)) };
const unlisted = { name: "Unlisted Clinic (NOT approved)", ...(await C.makeHospital(new Uint8Array(32).fill(13), unlistedWallet.address)) };
const approved = [sanjeevani, narmada];

const PROCEDURES: Record<string, string> = { "4401": "Appendectomy", "4402": "Cataract surgery", "5001": "Angioplasty", "6101": "Knee replacement", "9999": "Cosmetic surgery" };

const now = BigInt(await networkHelpers.time.latest());
const mkPolicy = (policyId: bigint, plan: string, limitRupees: number, covered: bigint[], start: bigint, expiry: bigint) =>
  ({ plan, ...C.makePolicy({ policyId, policyStart: start, policyExpiry: expiry, policyLimit: BigInt(limitRupees * 100), policySalt: C.randomSecret(), coveredProcedures: covered }) });

const patients = [
  { name: "Aarav (fictional)", wallet: aarav, policy: mkPolicy(1001n, "Gold", 200_000, [4401n, 4402n, 5001n], now - 90n * DAY, now + 275n * DAY) },
  { name: "Meera (fictional)", wallet: meera, policy: mkPolicy(1002n, "Silver", 50_000, [4401n, 4402n], now - 60n * DAY, now + 305n * DAY) },
  { name: "Kabir (fictional)", wallet: kabir, policy: mkPolicy(1003n, "Basic (EXPIRED)", 30_000, [4402n], now - 400n * DAY, now - 35n * DAY) },
  { name: "Ishita (fictional)", wallet: ishita, policy: mkPolicy(1004n, "Gold", 300_000, [4401n, 5001n, 6101n], now - 30n * DAY, now + 335n * DAY) },
];

// ---------- deploy ----------
const token = await ethers.deployContract("TestINR");
const verifier = await ethers.deployContract("ClaimVerifier");
const hospitalRoot = C.merkleTree(approved.map((h) => h.leaf), C.HOSPITAL_DEPTH).root;
const insureTrust = await ethers.deployContract("InsureTrust", [verifier, token, hospitalRoot]);
const POOL = 1_000_000_00n; // ₹10,00,000 test pool
await token.mint(insureTrust, POOL);
for (const p of patients) await insureTrust.registerPolicy(p.policy.commitment, p.wallet);
const contractAddress = await insureTrust.getAddress();

// ---------- claims ----------
type Row = { n: number; patient: string; hospital: string; scenario: string; expected: string; result: string; detail: string; ok: boolean };
const rows: Row[] = [];
let n = 0;
const proofs = new Map<string, any>();

async function makeProof(p: typeof patients[number], hospital: typeof sanjeevani, claimId: bigint, procedureCode: bigint, amountRupees: number, daysAgo: bigint) {
  const input = await C.buildClaim({
    hospital, hospitals: approved, policy: p.policy, claimId, procedureCode,
    claimDate: now - daysAgo * DAY, claimAmount: BigInt(amountRupees * 100), claimSubmissionTime: now - 60n,
    chainId: 31337n, verifyingContract: contractAddress,
  });
  const quiet = console.log; console.log = () => {}; // hide circom's internal error print-outs
  try {
    const t = Date.now();
    const { proof, publicSignals } = await C.proveClaim(input, WASM, ZKEY);
    return { calldata: await C.toCalldata(proof, publicSignals), ms: Date.now() - t };
  } finally { console.log = quiet; }
}

async function attempt(o: { key?: string; reuse?: string; patient: typeof patients[number]; submitter?: any; hospital: typeof sanjeevani; claimId: bigint; code: bigint; amount: number; daysAgo?: bigint; scenario: string; expected: "PAID" | "REJECTED" }) {
  n++;
  const row: Row = { n, patient: o.patient.name, hospital: o.hospital.name, scenario: o.scenario, expected: o.expected, result: "", detail: "", ok: false };
  let made;
  if (o.reuse) made = proofs.get(o.reuse);
  else {
    try { made = await makeProof(o.patient, o.hospital, o.claimId, o.code, o.amount, o.daysAgo ?? 2n); }
    catch {
      const why = C.claimProblems({
        hospital: o.hospital, hospitals: approved, policy: o.patient.policy, procedureCode: o.code,
        claimDate: now - (o.daysAgo ?? 2n) * DAY, claimAmount: BigInt(o.amount * 100), claimSubmissionTime: now - 60n,
      });
      row.result = "REJECTED"; row.detail = `Circuit refused to create a proof: ${why.join(" ") || "a rule failed"}`;
    }
  }
  if (made) {
    if (o.key) proofs.set(o.key, made);
    const [a, b, c, pub] = made.calldata;
    const before = await token.balanceOf(o.hospital.payout === sanjeevani.payout ? sanjeevaniWallet : narmadaWallet);
    try {
      await (await insureTrust.connect(o.submitter ?? o.patient.wallet).submitClaim(a, b, c, pub)).wait();
      const after = await token.balanceOf(o.hospital.payout === sanjeevani.payout ? sanjeevaniWallet : narmadaWallet);
      row.result = "PAID"; row.detail = `Proof verified on-chain; ${rupees(after - before)} tINR sent to hospital (proof made in ${(made.ms / 1000).toFixed(1)} s)`;
    } catch (e: any) {
      row.result = "REJECTED"; row.detail = reasonOf(e, insureTrust);
    }
  }
  row.ok = row.result === o.expected;
  rows.push(row);
  console.log(`${row.ok ? "✔" : "✖"} #${n} ${row.scenario} → ${row.result}  (${row.detail})`);
}

console.log("\nRunning InsureTrust demo on a local test chain...\n");
await attempt({ key: "aarav", patient: patients[0], hospital: sanjeevani, claimId: 50001n, code: 4401n, amount: 85_000, scenario: "Appendectomy, ₹85,000 (Gold, limit ₹2,00,000)", expected: "PAID" });
await attempt({ reuse: "aarav", patient: patients[0], hospital: sanjeevani, claimId: 50001n, code: 4401n, amount: 85_000, scenario: "Same claim submitted again", expected: "REJECTED" });
await attempt({ patient: patients[1], hospital: narmada, claimId: 50002n, code: 4402n, amount: 60_000, scenario: "Cataract surgery, ₹60,000 (Silver, limit ₹50,000)", expected: "REJECTED" });
await attempt({ patient: patients[2], hospital: sanjeevani, claimId: 50003n, code: 4402n, amount: 20_000, scenario: "Cataract surgery on an expired policy", expected: "REJECTED" });
await attempt({ patient: patients[3], hospital: narmada, claimId: 50004n, code: 9999n, amount: 90_000, scenario: "Cosmetic surgery (not covered)", expected: "REJECTED" });
await attempt({ patient: patients[1], hospital: unlisted, claimId: 50005n, code: 4401n, amount: 30_000, scenario: "Claim from a hospital NOT on the approved list", expected: "REJECTED" });
await attempt({ key: "ishita", patient: patients[3], hospital: narmada, claimId: 50006n, code: 6101n, amount: 240_000, scenario: "Stranger (not the patient) submits Ishita's proof", submitter: kabir, expected: "REJECTED" });
await attempt({ reuse: "ishita", patient: patients[3], hospital: narmada, claimId: 50006n, code: 6101n, amount: 240_000, scenario: "Knee replacement, ₹2,40,000 — Ishita submits", expected: "PAID" });

// ---------- insurer's view (what's on the blockchain) ----------
const count = Number(await insureTrust.claimCount());
const ledger = [];
for (let i = 0; i < count; i++) {
  const c = await insureTrust.claims(i);
  ledger.push({ i, policy: short(c.policyCommitment), payout: short(c.hospitalPayout), amount: rupees(c.amount) });
}
const poolLeft = await token.balanceOf(insureTrust);

// ---------- encrypted records & doctor access ----------
// Locked files go to a local folder named by content ID (same IDs as IPFS). Clearly NOT public IPFS.
function folderStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  return {
    label: `local folder \`${dir}/\` (fallback, NOT public IPFS; file names are the same content IDs IPFS would use)`,
    async put(bytes: Uint8Array) { const cid = await R.cidOf(bytes); writeFileSync(`${dir}/${cid}`, bytes); return cid; },
    async get(cid: string) { return R.verifiedFile(cid, existsSync(`${dir}/${cid}`) ? new Uint8Array(readFileSync(`${dir}/${cid}`)) : undefined); },
  };
}
const IPFS_API = process.env.IPFS_API; // set automatically inside Docker (compose.yaml)
const store = IPFS_API
  ? { ...R.ipfsStore(IPFS_API), label: `local IPFS node (Kubo in Docker, ${IPFS_API}); offline mode, so files stay on this laptop and are not published to the public IPFS network` }
  : folderStore(".storage");
const healthRecords = await ethers.deployContract("HealthRecords");
const names = new Map<string, string>([[aarav.address, "Aarav"], [drRao.address, "Dr. Rao (fictional)"], [stranger.address, "Stranger"], [sanjeevaniWallet.address, "Sanjeevani"]]);
const keysOf = new Map<string, any>();

type Step = { n: number; step: string; expected: "ALLOWED" | "BLOCKED"; result: string; detail: string; ok: boolean };
const steps: Step[] = [];
async function step(text: string, expected: Step["expected"], action: () => Promise<string>) {
  const s: Step = { n: steps.length + 1, step: text, expected, result: "", detail: "", ok: false };
  try { s.detail = await action(); s.result = "ALLOWED"; } catch (e: any) { s.result = "BLOCKED"; s.detail = reasonOf(e, healthRecords); }
  s.ok = s.result === expected;
  steps.push(s);
  console.log(`${s.ok ? "✔" : "✖"} R${s.n} ${s.step} → ${s.result}  (${s.detail})`);
}
async function unlockLocker(signer: any) {
  const keys = await R.deriveKeys(signer); // one wallet signature, no transaction cost
  keysOf.set(signer.address, keys);
  await (await healthRecords.connect(signer).setEncryptionKey(R.bytesToHex(keys.publicKey))).wait();
}
async function openRecord(id: bigint, signer: any) {
  const onChain = await healthRecords.records(id);
  const recordKey = await R.unwrapKey(R.hexToBytes(await healthRecords.keyFor(id, signer)), keysOf.get(signer.address));
  const record = await R.decryptRecord(await store.get(onChain.cid), recordKey);
  await (await healthRecords.connect(signer).logView(id)).wait();
  const condition = record.entry.find((e: any) => e.resource.resourceType === "Condition").resource.code.text;
  return `Decrypted on their device (condition: "${condition}"); view written to the on-chain access history`;
}

console.log("\nEncrypted records & doctor access...\n");
let recordId = 0n, recordCid = "", lockedFile = new Uint8Array(), patientWrappedKey = "";
await step("Aarav, Dr. Rao and a stranger unlock their health lockers (create keys from a wallet signature)", "ALLOWED", async () => {
  for (const s of [aarav, drRao, stranger]) await unlockLocker(s);
  return "3 public keys published on-chain (32 bytes each); private keys never leave each person's device";
});
await step("Sanjeevani writes Aarav's record, locks it, stores the locked file and adds it to Aarav's locker", "ALLOWED", async () => {
  const record = R.fhirRecord({
    patientRef: "p-aarav", patientName: "Aarav (fictional)", condition: "Acute appendicitis",
    procedureCode: 4401, procedureName: "Appendectomy", date: "2026-11-21", medications: ["Amoxicillin 500 mg", "Paracetamol 650 mg"],
  });
  const { ciphertext, key } = await R.encryptRecord(record);
  recordCid = await store.put(ciphertext);
  lockedFile = ciphertext;
  const aaravPublicKey = R.hexToBytes(await healthRecords.encryptionKey(aarav));
  const wrapped = await R.wrapKey(key, aaravPublicKey);
  patientWrappedKey = R.bytesToHex(wrapped);
  await (await healthRecords.connect(sanjeevaniWallet).addRecord(aarav, recordCid, patientWrappedKey)).wait();
  return `Locked file ${ciphertext.length} bytes, content ID \`${recordCid.slice(0, 14)}…\`; on-chain: content ID + a ${wrapped.length}-byte locked key for Aarav`;
});
await step("Aarav opens his own record", "ALLOWED", () => openRecord(recordId, aarav));
await step("Dr. Rao tries to open it before Aarav gives access", "BLOCKED", () => openRecord(recordId, drRao));
await step("Aarav gives Dr. Rao access for 7 days", "ALLOWED", async () => {
  const recordKey = await R.unwrapKey(R.hexToBytes(await healthRecords.keyFor(recordId, aarav)), keysOf.get(aarav.address));
  const forDoctor = await R.wrapKey(recordKey, R.hexToBytes(await healthRecords.encryptionKey(drRao)));
  const until = BigInt(await networkHelpers.time.latest()) + 7n * DAY;
  await (await healthRecords.connect(aarav).grantAccess(recordId, drRao, R.bytesToHex(forDoctor), until)).wait();
  return `Record key re-locked for Dr. Rao's public key; expires ${new Date(Number(until) * 1000).toISOString().slice(0, 10)}`;
});
await step("Dr. Rao opens the record", "ALLOWED", () => openRecord(recordId, drRao));
await step("A stranger copies Aarav's locked key from the public blockchain and tries to unlock it", "BLOCKED", async () => {
  await R.unwrapKey(R.hexToBytes(patientWrappedKey), keysOf.get(stranger.address));
  return "unlocked (this should never happen)";
});
await step("Aarav revokes Dr. Rao's access", "ALLOWED", async () => {
  await (await healthRecords.connect(aarav).revokeAccess(recordId, drRao)).wait();
  return "Dr. Rao's locked key removed; the system now refuses his requests";
});
await step("Dr. Rao tries to open the record again", "BLOCKED", () => openRecord(recordId, drRao));

const history = (await healthRecords.queryFilter("*" as any))
  .filter((e: any) => e.args?.recordId === recordId)
  .map((e: any) => {
    const who = names.get(e.args.grantee ?? e.args.viewer ?? e.args.issuer) ?? short(e.args.grantee ?? e.args.viewer ?? e.args.issuer);
    const what = { RecordAdded: "Record added by", AccessGranted: "Access granted to", RecordViewed: "Record opened by", AccessRevoked: "Access revoked for" }[e.fragment.name as string];
    return `| ${e.blockNumber} | ${what} | ${who} |`;
  });
const allOk = rows.every((r) => r.ok) && steps.every((s) => s.ok);

// ---------- report ----------
const md = `# InsureTrust demo report

Generated ${new Date().toISOString()} by \`scripts/demo.ts\` on a local Hardhat test chain (chain ID 31337).
**All patients, hospitals, policies and money are fictional. tINR is a test token with no real value.**

## Result: ${allOk ? "✅ everything behaved as expected" : "❌ something did NOT behave as expected"}
- Insurance claims: ${rows.filter((r) => r.ok).length}/${rows.length} as expected
- Encrypted records & doctor access: ${steps.filter((s) => s.ok).length}/${steps.length} as expected

## Part 1 — Insurance claims (zero-knowledge proofs)

| # | Patient | Hospital | Scenario | Expected | Result | Details |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.n} | ${r.patient} | ${r.hospital} | ${r.scenario} | ${r.expected} | ${r.ok ? "✅" : "❌"} ${r.result} | ${r.detail} |`).join("\n")}

## What the insurer sees on the blockchain
| Claim | Policy fingerprint | Paid to (hospital wallet) | Amount |
|---|---|---|---|
${ledger.map((l) => `| ${l.i} | \`${l.policy}\` | \`${l.payout}\` | ${l.amount} |`).join("\n")}

Pool: started at ${rupees(POOL)}, now ${rupees(poolLeft)}.

## What stayed private
Never sent to the insurer or the blockchain: diagnosis, procedure name/code, treatment date, claim ID, policy limit, expiry date, covered-procedure list, hospital signing key.
The procedure names in the table above are shown only because this report is written from the demo's own (fictional) data.

## Part 2 — Encrypted medical records & doctor access

Storage used: ${store.label}

| # | Step | Expected | Result | Details |
|---|---|---|---|---|
${steps.map((s) => `| R${s.n} | ${s.step} | ${s.expected} | ${s.ok ? "✅" : "❌"} ${s.result} | ${s.detail} |`).join("\n")}

### Access history (rebuilt from on-chain events)
| Block | Event | Who |
|---|---|---|
${history.join("\n")}

### What is stored where
| Where | What is there | Can others read the medical details? |
|---|---|---|
| ${IPFS_API ? `IPFS, content ID \`${recordCid}\` (open http://127.0.0.1:8080/ipfs/${recordCid} to see the locked file)` : `Storage file \`.storage/${recordCid.slice(0, 14)}…\``} | The locked record, ${lockedFile.length} bytes. First bytes: \`${R.bytesToHex(lockedFile.slice(0, 16))}…\` | No: it's unreadable without the record key |
| Blockchain (HealthRecords) | Content ID, patient and issuer addresses, 92-byte locked keys, access events | No: no medical data, and each locked key opens only with its owner's private key |
| Each person's own device (memory only) | Their private key and, once they open it, the readable record | Only that person |

Honest limits: revoking stops access through this system, but it cannot erase a copy Dr. Rao already saw. Addresses and timings on the blockchain are public.

## Setup used
- Approved hospitals: ${approved.map((h) => h.name).join(", ")}
- Policies: ${patients.map((p) => `${p.name} — ${p.policy.plan}, limit ${rupees(p.policy.policyLimit)}, covers ${p.policy.coveredProcedures.map((c) => PROCEDURES[String(c)]).join(", ")}`).join("; ")}
- Contracts: InsureTrust \`${contractAddress}\`, ClaimVerifier \`${await verifier.getAddress()}\`, TestINR \`${await token.getAddress()}\`, HealthRecords \`${await healthRecords.getAddress()}\`
`;
writeFileSync("docs/demo-report.md", md);
console.log(`\n${allOk ? "✅ All" : "❌ Not all"} ${rows.length + steps.length} scenarios behaved as expected. Report written to docs/demo-report.md`);
(globalThis as any).curve_bn128?.terminate();
