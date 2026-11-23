// Insurer screen: overview, public claims dashboard, hospital approval, policies, money pool.
import { useState } from "react";
import { getAddress } from "ethers";
import * as C from "../../lib/claim.js";
import { eventsOf, send, txUrl } from "./chain.js";
import { PLANS, PROCEDURES, policyNumber, procedureName } from "./catalog.js";
import { approvedList, nameOf, rootOf, updateInbox, useInbox } from "./store.js";
import {
  ActionButton, Card, Empty, ErrorNote, Field, Loading, Pill, Receipt, Seal, Who,
  dateOf, dateTimeOf, inputToSeconds, nowSeconds, rupees, short, todayInput, useApp, useLoad,
} from "./ui.jsx";

export default function Insurer() {
  const { session } = useApp();
  return (
    <div className="grid">
      {!session.isInsurer && (
        <p className="notice wide">Public view. Every claim below was verified by a zero-knowledge proof on-chain and paid automatically. No medical data is ever shown.</p>
      )}
      <Overview />
      <ClaimsDashboard />
      {session.isInsurer && <Hospitals />}
      {session.isInsurer && <IssuePolicy />}
      {session.isInsurer && <Policies />}
      {session.isInsurer && <Pool />}
    </div>
  );
}

function Overview() {
  const { session } = useApp();
  const inbox = useInbox();
  const data = useLoad(async () => {
    const it = session.insureTrust;
    const [pool, root, settled, registered] = await Promise.all([
      session.token.balanceOf(session.deployment.insureTrust),
      it.hospitalRoot(),
      eventsOf(session, it, it.filters.ClaimSettled()),
      eventsOf(session, it, it.filters.PolicyRegistered()),
    ]);
    const last = settled.at(-1);
    const latest = last && { e: last, claim: await it.claims(last.args.claimIndex) };
    return { pool, root, latest, paidCount: settled.length, paidTotal: settled.reduce((sum, e) => sum + e.args.amount, 0n), policies: registered.length };
  }, [session]);
  if (data.loading && !data.value) return <Card title="Overview" wide><Loading /></Card>;
  if (data.error) return <Card title="Overview" wide><ErrorNote>{data.error}</ErrorNote></Card>;
  const v = data.value;
  const list = approvedList(inbox);
  const listOnChain = list.length > 0 && rootOf(list) === v.root;
  return (
    <Card title="Overview" subtitle="Live from the blockchain" wide>
      <div className={v.latest ? "overview" : undefined}>
      <div className="stats">
        <div className="stat"><span>Money pool</span><b>{rupees(v.pool)}</b><small>test tINR (no real value)</small></div>
        <div className="stat"><span>Claims paid</span><b>{v.paidCount}</b><small>{rupees(v.paidTotal)} in total</small></div>
        <div className="stat"><span>Policies issued</span><b>{v.policies}</b><small>only fingerprints on-chain</small></div>
        {list.length === 0 && v.root ? (
          // This browser doesn't hold the list (e.g. a guest), but the blockchain has its fingerprint.
          <div className="stat"><span>Approved hospitals</span><b>On-chain</b><small><Seal>list fingerprint {short(v.root)}</Seal></small></div>
        ) : (
          <div className="stat"><span>Approved hospitals</span><b>{list.length}</b><small>{list.length === 0 ? "none yet" : listOnChain ? <Seal>list saved on-chain</Seal> : "list not saved on-chain"}</small></div>
        )}
      </div>
      {v.latest && (
        <Receipt no={`Claim no. ${String(v.latest.e.args.claimIndex).padStart(4, "0")}`} paidOn={dateTimeOf(v.latest.claim.settledAt)}
          policy={<code>{short(v.latest.claim.policyCommitment)}</code>} paidTo={<Who address={v.latest.claim.hospitalPayout} />}
          amount={rupees(v.latest.claim.amount)}
          tx={txUrl(session, v.latest.e.transactionHash) && <a href={txUrl(session, v.latest.e.transactionHash)} target="_blank" rel="noreferrer">View transaction ↗</a>} />
      )}
      </div>
    </Card>
  );
}

function ClaimsDashboard() {
  const { session } = useApp();
  const data = useLoad(async () => {
    const it = session.insureTrust;
    const events = await eventsOf(session, it, it.filters.ClaimSettled());
    const rows = await Promise.all(events.map(async (e) => ({ e, claim: await it.claims(e.args.claimIndex) })));
    return rows.reverse();
  }, [session]);
  return (
    <Card title="Paid claims" subtitle="Verified by a zero-knowledge proof inside the smart contract and paid automatically. You see the amount, policy fingerprint and payout wallet only: never the diagnosis, procedure or treatment date." wide>
      {data.loading && !data.value ? <Loading /> : data.error ? <ErrorNote>{data.error}</ErrorNote> : data.value.length === 0 ? (
        <Empty>No claims paid yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Paid on</th><th>Policy fingerprint</th><th>Paid to hospital</th><th className="num">Amount</th><th>Proof</th><th></th></tr></thead>
            <tbody>
              {data.value.map(({ e, claim }) => (
                <tr key={e.transactionHash}>
                  <td>{String(e.args.claimIndex)}</td>
                  <td>{dateTimeOf(claim.settledAt)}</td>
                  <td><code>{short(claim.policyCommitment)}</code></td>
                  <td><Who address={claim.hospitalPayout} /></td>
                  <td className="num"><b>{rupees(claim.amount)}</b></td>
                  <td><Seal>verified on-chain</Seal></td>
                  <td>{txUrl(session, e.transactionHash) ? <a href={txUrl(session, e.transactionHash)} target="_blank" rel="noreferrer">tx ↗</a> : <code>{short(e.transactionHash)}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Hospitals() {
  const { session } = useApp();
  const inbox = useInbox();
  const onChain = useLoad(() => session.insureTrust.hospitalRoot(), [session]);
  const known = Object.entries(inbox.hospitalKeys);
  const [picked, setPicked] = useState(null); // null = same as the saved list
  const selected = picked ?? new Set(inbox.approvedHospitals);
  const toggle = (address) => {
    const next = new Set(selected);
    next.has(address) ? next.delete(address) : next.add(address);
    setPicked(next);
  };
  const saved = approvedList(inbox);
  const inSync = saved.length > 0 && onChain.value === rootOf(saved);

  async function save() {
    // Keep the current order, then add newly approved hospitals at the end.
    const order = [...inbox.approvedHospitals.filter((a) => selected.has(a)), ...known.map(([a]) => a).filter((a) => selected.has(a) && !inbox.approvedHospitals.includes(a))];
    if (order.length === 0) throw new Error("Pick at least one hospital to approve.");
    const root = rootOf(approvedList({ ...inbox, approvedHospitals: order }));
    const receipt = await send(session.insureTrust.setHospitalRoot(root));
    updateInbox((d) => { d.approvedHospitals = order; });
    setPicked(null);
    return { message: `Approved list saved: ${order.length} hospital(s). Only its fingerprint (Merkle root) is on-chain.`, tx: receipt.hash };
  }

  return (
    <Card title="Approved hospitals" subtitle="Review registered hospitals and approve the ones you trust. Only a fingerprint of the list goes on-chain." badge={saved.length > 0 && (inSync ? <Seal>saved on-chain</Seal> : <Pill tone="warn">Not saved on-chain</Pill>)}>
      {known.length === 0 ? <Empty>No hospital has registered yet.</Empty> : (
        <ul className="checklist">
          {known.map(([address, key]) => (
            <li key={address}>
              <label><input type="checkbox" checked={selected.has(address)} onChange={() => toggle(address)} /> <b>{key.name}</b> <code>{short(address)}</code>{key.regNo && <span className="muted small">Reg. {key.regNo} · {key.city}{key.nabh === "yes" ? " · NABH accredited" : ""}</span>}</label>
            </li>
          ))}
        </ul>
      )}
      <ActionButton action={save} busyLabel="Saving list on-chain…" disabled={known.length === 0}>Save approved list on-chain</ActionButton>
    </Card>
  );
}

function IssuePolicy() {
  const { session } = useApp();
  const inbox = useInbox();
  const patients = Object.entries(inbox.people).filter(([, p]) => p.role === "patient");
  const [form, setForm] = useState({ patient: patients[0]?.[0] ?? "", plan: PLANS[0].name, limit: PLANS[0].limitRupees, start: todayInput(-30), end: todayInput(335), covered: PLANS[0].covered });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const choosePlan = (e) => { const plan = PLANS.find((p) => p.name === e.target.value); setForm({ ...form, plan: plan.name, limit: plan.limitRupees, covered: plan.covered }); };
  const toggle = (code) => setForm({ ...form, covered: form.covered.includes(code) ? form.covered.filter((c) => c !== code) : [...form.covered, code] });

  async function issue() {
    let patient;
    try { patient = getAddress(form.patient.trim()); } catch { throw new Error("Enter the patient's wallet address (0x…)."); }
    if (form.covered.length === 0) throw new Error("Pick at least one covered procedure.");
    if (!(Number(form.limit) > 0)) throw new Error("The limit must be more than zero.");
    if (inputToSeconds(form.end) <= inputToSeconds(form.start)) throw new Error("The end date must be after the start date.");
    const policy = C.makePolicy({
      policyId: C.randomId(),
      policyStart: inputToSeconds(form.start),
      policyExpiry: inputToSeconds(form.end),
      policyLimit: BigInt(Math.round(Number(form.limit) * 100)),
      policySalt: C.randomSecret(),
      coveredProcedures: form.covered.map(BigInt),
    });
    const receipt = await send(session.insureTrust.registerPolicy(policy.commitment, patient));
    updateInbox((d) => { d.policies[String(policy.commitment)] = { ...policy, patient: patient.toLowerCase(), plan: form.plan, issuedAt: nowSeconds() }; });
    return { message: `Policy issued to ${nameOf(patient) ?? short(patient)}. Only its fingerprint went on-chain; the policy file was handed to the patient (simulated).`, tx: receipt.hash };
  }

  return (
    <Card title="Issue a policy" subtitle="The policy terms stay off-chain. The blockchain only stores a fingerprint and who owns it.">
      <div className="form">
        <Field label="Patient" hint={nameOf(form.patient) ? `= ${nameOf(form.patient)}` : "Pick from the list or paste the patient's wallet address"}>
          <input list="patients" value={form.patient} onChange={set("patient")} placeholder="0x… wallet address" />
          <datalist id="patients">{patients.map(([a, p]) => <option key={a} value={a}>{p.name}</option>)}</datalist>
        </Field>
        <div className="row">
          <Field label="Plan"><select value={form.plan} onChange={choosePlan}>{PLANS.map((p) => <option key={p.name}>{p.name}</option>)}</select></Field>
          <Field label="Limit per claim (₹)"><input type="number" min="1" value={form.limit} onChange={set("limit")} /></Field>
        </div>
        <div className="row">
          <Field label="Starts"><input type="date" value={form.start} onChange={set("start")} /></Field>
          <Field label="Ends (not included)" hint="Pick a past date to demo an expired policy"><input type="date" value={form.end} onChange={set("end")} /></Field>
        </div>
        <Field label="Covered procedures">
          <div className="chips">
            {PROCEDURES.map((p) => (
              <label key={p.code} className={`chip${form.covered.includes(p.code) ? " on" : ""}`}>
                <input type="checkbox" checked={form.covered.includes(p.code)} onChange={() => toggle(p.code)} /> {p.name}
              </label>
            ))}
          </div>
        </Field>
        <ActionButton action={issue} busyLabel="Registering policy…">Issue policy</ActionButton>
      </div>
    </Card>
  );
}

function Policies() {
  const { session } = useApp();
  const inbox = useInbox();
  const policies = Object.values(inbox.policies);
  const status = useLoad(async () => Object.fromEntries(await Promise.all(policies.map(async (p) => [String(p.commitment), await session.insureTrust.policyHolder(p.commitment)]))), [session, policies.length]);
  return (
    <Card title="Policies issued" subtitle="Your copies of the policy files">
      {policies.length === 0 ? <Empty>No policies issued from this browser yet.</Empty> : (
        <ul className="list">
          {policies.map((p) => {
            const holder = status.value?.[String(p.commitment)];
            const revoked = holder !== undefined && BigInt(holder) === 0n;
            const expired = nowSeconds() >= p.policyExpiry;
            return (
              <li key={String(p.commitment)}>
                <div>
                  <b>{nameOf(p.patient) ?? short(p.patient)}</b> · {policyNumber(p)} · {p.plan} · limit {rupees(p.policyLimit)} · {dateOf(p.policyStart)} → {dateOf(p.policyExpiry)}
                  <div className="muted small">Covers: {p.coveredProcedures.map(procedureName).join(", ")}</div>
                </div>
                <div className="actions-inline">
                  <Pill tone={revoked ? "bad" : expired ? "warn" : "ok"}>{revoked ? "Revoked" : expired ? "Expired" : "Active"}</Pill>
                  {!revoked && <ActionButton small tone="ghost" busyLabel="Revoking…" action={async () => ({ message: "Policy revoked.", tx: (await send(session.insureTrust.revokePolicy(p.commitment))).hash })}>Revoke</ActionButton>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Pool() {
  const { session } = useApp();
  const [amount, setAmount] = useState(500000);
  return (
    <Card title="Money pool" subtitle="Claims are paid from here automatically. Test money only.">
      <div className="form">
        <Field label="Add test money (₹)"><input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <ActionButton busyLabel="Adding…" action={async () => {
          const paise = BigInt(Math.round(Number(amount) * 100));
          if (paise <= 0n) throw new Error("Enter an amount above zero.");
          const receipt = await send(session.token.mint(session.deployment.insureTrust, paise));
          return { message: `${rupees(paise)} test tINR added to the pool.`, tx: receipt.hash };
        }}>Add to pool</ActionButton>
      </div>
    </Card>
  );
}
