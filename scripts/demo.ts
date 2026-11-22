// End-to-end demo on a local test blockchain, with a written report.
// Run (in WSL on Windows laptops with the Hardhat block):  npx hardhat run scripts/demo.ts
// Needs `npm run circuit claim` first. ALL people, hospitals and money here are fictional / test-only.
import { network } from "hardhat";
import { writeFileSync } from "node:fs";
import * as C from "../lib/claim.js";

const { ethers, networkHelpers } = await network.create();
const WASM = "circuits/build/claim_js/claim.wasm";
const ZKEY = "circuits/build/claim.zkey";
const DAY = 86_400n;
const rupees = (paise: bigint) => "₹" + (Number(paise) / 100).toLocaleString("en-IN");
const short = (x: string | bigint) => { const s = typeof x === "bigint" ? "0x" + x.toString(16) : x; return s.slice(0, 8) + "…" + s.slice(-4); };

await C.init();

// ---------- people & organisations (fictional) ----------
const [insurer, aarav, meera, kabir, ishita, sanjeevaniWallet, narmadaWallet, unlistedWallet] = await ethers.getSigners();
const sanjeevani = { name: "Sanjeevani Multispeciality (fictional)", ...C.makeHospital(new Uint8Array(32).fill(11), sanjeevaniWallet.address) };
const narmada = { name: "Narmada Heart Institute (fictional)", ...C.makeHospital(new Uint8Array(32).fill(12), narmadaWallet.address) };
const unlisted = { name: "Unlisted Clinic (NOT approved)", ...C.makeHospital(new Uint8Array(32).fill(13), unlistedWallet.address) };
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
  const input = C.buildClaim({
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
    catch { row.result = "REJECTED"; row.detail = "Circuit refused to create a proof (a rule failed)"; }
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
      const data = e.data ?? e.error?.data ?? e.info?.error?.data;
      let reason = e.revert?.name;
      try { reason ??= insureTrust.interface.parseError(data)?.name; } catch {}
      row.result = "REJECTED"; row.detail = `Contract refused: ${reason ?? e.shortMessage ?? "reverted"}`;
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
const allOk = rows.every((r) => r.ok);

// ---------- report ----------
const md = `# InsureTrust demo report

Generated ${new Date().toISOString()} by \`scripts/demo.ts\` on a local Hardhat test chain (chain ID 31337).
**All patients, hospitals, policies and money are fictional. tINR is a test token with no real value.**

## Result: ${allOk ? "✅ every scenario behaved as expected" : "❌ some scenarios did NOT behave as expected"} (${rows.filter((r) => r.ok).length}/${rows.length})

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

## Setup used
- Approved hospitals: ${approved.map((h) => h.name).join(", ")}
- Policies: ${patients.map((p) => `${p.name} — ${p.policy.plan}, limit ${rupees(p.policy.policyLimit)}, covers ${p.policy.coveredProcedures.map((c) => PROCEDURES[String(c)]).join(", ")}`).join("; ")}
- Contracts: InsureTrust \`${contractAddress}\`, ClaimVerifier \`${await verifier.getAddress()}\`, TestINR \`${await token.getAddress()}\`
`;
writeFileSync("docs/demo-report.md", md);
console.log(`\n${allOk ? "✅ All" : "❌ Not all"} ${rows.length} scenarios behaved as expected. Report written to docs/demo-report.md`);
(globalThis as any).curve_bn128?.terminate();
