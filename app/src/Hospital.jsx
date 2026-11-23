// Hospital screen (+ doctor section): identity, write records, prepare claims with a ZK proof, shared records.
import { useState } from "react";
import * as C from "../../lib/claim.js";
import * as R from "../../lib/records.js";
import { send } from "./chain.js";
import { PROCEDURES, procedureName } from "./catalog.js";
import { encryptionKeyOf, hospitalKeyFor, publishEncryptionKey, recordKeysFor } from "./keys.js";
import RecordView from "./RecordView.jsx";
import { approvedList, nameOf, rootOf, updateInbox, useInbox } from "./store.js";
import {
  ActionButton, Card, Empty, ErrorNote, Field, Loading, Pill, PrivacyPanel, Who,
  dateOf, inputToSeconds, nowSeconds, rupees, short, todayInput, useApp, useLoad,
} from "./ui.jsx";

export default function Hospital() {
  const { session } = useApp();
  if (!session.signer) return <p className="notice">Connect a wallet to use the hospital screen.</p>;
  return (
    <div className="grid">
      <Identity />
      <WriteRecord />
      <PrepareClaim />
      <MyClaims />
      <SharedWithMe />
    </div>
  );
}

const myAddress = (session) => session.address.toLowerCase();

function Identity() {
  const { session } = useApp();
  const inbox = useInbox();
  const me = myAddress(session);
  const published = inbox.hospitalKeys[me];
  const onChainRoot = useLoad(() => session.insureTrust.hospitalRoot(), [session]);
  const list = approvedList(inbox);
  const approved = inbox.approvedHospitals.includes(me) && list.length > 0 && onChainRoot.value === rootOf(list);
  const [name, setName] = useState(nameOf(me) ?? "");

  async function create() {
    if (!name.trim()) throw new Error("Enter the hospital's name.");
    const key = await hospitalKeyFor(session); // one wallet signature, no transaction
    updateInbox((d) => {
      d.hospitalKeys[me] = { name: name.trim(), Ax: key.Ax, Ay: key.Ay };
      d.people[me] = { ...(d.people[me] ?? {}), name: name.trim(), role: d.people[me]?.role ?? "hospital" };
    });
    return "Claim-signing key created from your wallet signature and published. Now the insurer can approve you.";
  }

  return (
    <Card title="Your hospital" subtitle="Your claim-signing key proves claims come from you. It's re-created from your wallet each time and never stored."
      badge={published ? <Pill tone={approved ? "ok" : "warn"}>{approved ? "Approved by insurer ✓" : "Waiting for insurer approval"}</Pill> : <Pill tone="info">Not set up</Pill>}>
      {published ? (
        <p>Registered as <b>{published.name}</b>. Payouts go to this wallet: <code>{short(me)}</code>.</p>
      ) : inbox.people[me]?.role === "doctor" ? (
        <p className="muted">You're signed in as a doctor, so you don't need a hospital signing key. Records patients share with you are in <b>Doctor: records shared with me</b> below.</p>
      ) : (
        <div className="form">
          <Field label="Hospital name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sanjeevani Multispeciality" /></Field>
          <ActionButton action={create} busyLabel="Creating key (sign in your wallet)…">Create signing key</ActionButton>
        </div>
      )}
    </Card>
  );
}

function WriteRecord() {
  const { session, storage } = useApp();
  const inbox = useInbox();
  const me = myAddress(session);
  const patients = Object.entries(inbox.people).filter(([, p]) => p.role === "patient");
  const [form, setForm] = useState({ patient: patients[0]?.[0] ?? "", condition: "Acute appendicitis", procedure: 4401, date: todayInput(-1), medications: "Amoxicillin 500 mg, Paracetamol 650 mg" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function write() {
    const patient = form.patient;
    const patientName = nameOf(patient) ?? short(patient);
    const patientKey = await encryptionKeyOf(session, patient);
    if (!patientKey) throw new Error(`${patientName} hasn't unlocked their health locker yet (Patient tab → Unlock my locker).`);
    const record = R.fhirRecord({
      patientRef: `p-${patient.slice(2, 10)}`, patientName, condition: form.condition,
      procedureCode: Number(form.procedure), procedureName: procedureName(form.procedure), date: form.date,
      medications: form.medications.split(",").map((m) => m.trim()).filter(Boolean),
    });
    record.entry.push({ resource: { resourceType: "Organization", name: nameOf(me) ?? short(me) } });
    const { ciphertext, key } = await R.encryptRecord(record); // locked in this browser
    const cid = await storage.put(ciphertext);
    const lockedForPatient = await R.wrapKey(key, patientKey);
    const receipt = await send(session.healthRecords.addRecord(patient, cid, R.bytesToHex(lockedForPatient)));
    return { message: `Record locked and added to ${patientName}'s locker. Stored in ${storage.label} as ${short(cid)}; only that fingerprint is on-chain.`, tx: receipt.hash };
  }

  return (
    <Card title="Write a medical record" subtitle="The record is encrypted in this browser before it leaves it. Only the patient can open it, and they decide who else may.">
      {patients.length === 0 ? <Empty>No patients known yet.</Empty> : (
        <div className="form">
          <Field label="Patient"><select value={form.patient} onChange={set("patient")}>{patients.map(([a, p]) => <option key={a} value={a}>{p.name} ({short(a)})</option>)}</select></Field>
          <Field label="Diagnosis"><input value={form.condition} onChange={set("condition")} /></Field>
          <div className="row">
            <Field label="Procedure"><select value={form.procedure} onChange={set("procedure")}>{PROCEDURES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
            <Field label="Date"><input type="date" value={form.date} onChange={set("date")} /></Field>
          </div>
          <Field label="Prescriptions" hint="Comma-separated. Fictional data only."><input value={form.medications} onChange={set("medications")} /></Field>
          <ActionButton action={write} busyLabel="Encrypting and saving…">Encrypt & add to patient's locker</ActionButton>
        </div>
      )}
    </Card>
  );
}

function PrepareClaim() {
  const { session } = useApp();
  const inbox = useInbox();
  const me = myAddress(session);
  const shared = Object.entries(inbox.policyShares).filter(([, hs]) => hs.includes(me)).map(([c]) => inbox.policies[c]).filter(Boolean);
  const [form, setForm] = useState({ policy: "", procedure: 4401, date: todayInput(-1), amount: 42000 });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const policy = inbox.policies[form.policy] ?? shared[0];
  const myKey = inbox.hospitalKeys[me];
  const list = approvedList(inbox);
  const paise = BigInt(Math.round(Number(form.amount || 0) * 100));
  const problems = policy && myKey
    ? C.claimProblems({ hospital: { leaf: C.hash([myKey.Ax, myKey.Ay, BigInt(me)]) }, hospitals: list, policy, procedureCode: form.procedure, claimDate: inputToSeconds(form.date), claimAmount: paise, claimSubmissionTime: nowSeconds() - 60n })
    : [];

  async function prove() {
    if (!myKey) throw new Error("Set up your hospital first (top of this page).");
    if (problems.length) throw new Error(problems.join(" "));
    if (rootOf(list) !== (await session.insureTrust.hospitalRoot())) throw new Error("The approved-hospital list here doesn't match the blockchain. Ask the insurer to save it again.");
    const hospital = await hospitalKeyFor(session);
    const claimId = C.randomId();
    const input = await C.buildClaim({
      hospital, hospitals: list, policy, claimId, procedureCode: BigInt(form.procedure),
      claimDate: inputToSeconds(form.date), claimAmount: paise, claimSubmissionTime: nowSeconds() - 60n,
      chainId: BigInt(session.chainId), verifyingContract: session.deployment.insureTrust,
    });
    const started = performance.now();
    const { proof, publicSignals } = await C.proveClaim(input, "/zk/claim.wasm", "/zk/claim.zkey");
    const ms = Math.round(performance.now() - started);
    const calldata = await C.toCalldata(proof, publicSignals);
    updateInbox((d) => {
      d.claims[String(claimId)] = {
        id: String(claimId), patient: policy.patient, hospital: me, policyCommitment: policy.commitment,
        procedureCode: Number(form.procedure), claimDate: inputToSeconds(form.date), amount: paise,
        nullifier: input.claimNullifier, calldata, proofMs: ms, createdAt: nowSeconds(), status: "awaiting-patient",
      };
    });
    return `Zero-knowledge proof created in this browser in ${(ms / 1000).toFixed(1)} s and sent to ${nameOf(policy.patient) ?? "the patient"} for approval.`;
  }

  return (
    <Card title="Prepare an insurance claim" subtitle="Your browser creates a zero-knowledge proof that the claim follows the policy, without revealing the diagnosis, procedure or date to the insurer." wide>
      {shared.length === 0 ? <Empty>No patient has shared a policy with you yet (Patient tab → My insurance → Share with hospital).</Empty> : (
        <div className="two-col">
          <div className="form">
            <Field label="Patient's policy">
              <select value={String(policy?.commitment ?? "")} onChange={set("policy")}>
                {shared.map((p) => <option key={String(p.commitment)} value={String(p.commitment)}>{nameOf(p.patient) ?? short(p.patient)} · {p.plan} · limit {rupees(p.policyLimit)}</option>)}
              </select>
            </Field>
            {policy && <p className="muted small">Policy period {dateOf(policy.policyStart)} → {dateOf(policy.policyExpiry)}. Covers: {policy.coveredProcedures.map(procedureName).join(", ")}.</p>}
            <div className="row">
              <Field label="Procedure"><select value={form.procedure} onChange={set("procedure")}>{PROCEDURES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
              <Field label="Treatment date"><input type="date" value={form.date} onChange={set("date")} /></Field>
            </div>
            <Field label="Amount (₹)"><input type="number" min="1" value={form.amount} onChange={set("amount")} /></Field>
            {problems.length > 0 ? (
              <div className="problems"><b>This claim can't be proved:</b><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
            ) : policy && <p className="ok">✓ All policy rules pass. Ready to create the proof.</p>}
            <ActionButton action={prove} busyLabel="Creating zero-knowledge proof…" disabled={!policy}>Create proof & send to patient</ActionButton>
          </div>
          <PrivacyPanel
            publicItems={[`Amount: ${rupees(paise)}`, "Policy fingerprint", "Your payout wallet", "One-time claim code"]}
            privateItems={[`Procedure: ${procedureName(form.procedure)}`, `Treatment date: ${form.date}`, "Diagnosis & prescriptions", "Policy limit & covered list", "Which approved hospital signed (inside the proof)"]}
          />
        </div>
      )}
    </Card>
  );
}

const STATUS = { "awaiting-patient": ["warn", "Waiting for patient"], paid: ["ok", "Paid ✓"], rejected: ["bad", "Rejected"], declined: ["bad", "Declined by patient"] };
export const ClaimStatus = ({ status }) => <Pill tone={STATUS[status]?.[0] ?? "info"}>{STATUS[status]?.[1] ?? status}</Pill>;

function MyClaims() {
  const { session } = useApp();
  const inbox = useInbox();
  const mine = Object.values(inbox.claims).filter((c) => c.hospital === myAddress(session)).sort((a, b) => Number(b.createdAt - a.createdAt));
  return (
    <Card title="Claims you prepared">
      {mine.length === 0 ? <Empty>None yet.</Empty> : (
        <ul className="list">
          {mine.map((c) => (
            <li key={c.id}>
              <div><b>{nameOf(c.patient) ?? short(c.patient)}</b> · {procedureName(c.procedureCode)} · {rupees(c.amount)}<div className="muted small">Proof made in {(c.proofMs / 1000).toFixed(1)} s{c.reason ? ` · ${c.reason}` : ""}</div></div>
              <ClaimStatus status={c.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Doctor section: records patients have shared with this account.
function SharedWithMe() {
  const { session, storage } = useApp();
  const me = session.address;
  const myKey = useLoad(() => encryptionKeyOf(session, me), [session]);
  const data = useLoad(async () => {
    const hr = session.healthRecords;
    const grants = await hr.queryFilter(hr.filters.AccessGranted(null, me), session.deployment.fromBlock);
    const ids = [...new Set(grants.map((g) => g.args.recordId))];
    return Promise.all(ids.map(async (id) => ({ id, record: await hr.records(id), access: await hr.hasAccess(id, me) })));
  }, [session]);
  const [opened, setOpened] = useState({});

  async function open(id, cid) {
    const keys = await recordKeysFor(session);
    const recordKey = await R.unwrapKey(R.hexToBytes(await session.healthRecords.keyFor(id, me)), keys);
    const record = await R.decryptRecord(await storage.get(cid), recordKey);
    const receipt = await send(session.healthRecords.logView(id)); // goes into the patient's access history
    setOpened((o) => ({ ...o, [id]: record }));
    return { message: "Decrypted in your browser. This view was recorded in the patient's access history.", tx: receipt.hash };
  }

  return (
    <Card title="Doctor: records shared with me" subtitle="Patients can give you time-limited access to a record, and take it back." wide
      badge={myKey.value === null ? <Pill tone="warn">Encryption key not published</Pill> : myKey.value ? <Pill tone="ok">Encryption key published ✓</Pill> : null}>
      {myKey.value === null && (
        <div className="form">
          <p className="muted">Publish your public encryption key so patients can share records with you (one wallet signature + one transaction).</p>
          <ActionButton busyLabel="Publishing…" action={async () => { await publishEncryptionKey(session); return "Your public encryption key is on-chain. Patients can now share records with you."; }}>Publish my encryption key</ActionButton>
        </div>
      )}
      {data.loading && !data.value ? <Loading /> : data.error ? <ErrorNote>{data.error}</ErrorNote> : data.value.length === 0 ? <Empty>Nothing shared with you yet.</Empty> : (
        <ul className="list">
          {data.value.map(({ id, record, access }) => (
            <li key={String(id)} className="stack">
              <div className="list-row">
                <div>Record #{String(id)} of <Who address={record.patient} /> · added {dateOf(record.createdAt)}</div>
                {access ? <ActionButton small busyLabel="Opening…" action={() => open(id, record.cid)}>Open</ActionButton> : <Pill tone="bad">Access ended or revoked</Pill>}
              </div>
              {opened[id] && access && <RecordView record={opened[id]} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
