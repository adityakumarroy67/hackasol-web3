// Hospital screen: registration, encrypted medical records, insurance claims from the bill.
import { Fragment, useState } from "react";
import { AlertCircle, Check, FilePlus2, LayoutDashboard, ReceiptText } from "lucide-react";
import * as C from "../../lib/claim.js";
import * as R from "../../lib/records.js";
import { send } from "./chain.js";
import { DIAGNOSES, PROCEDURES, policyNumber, procedureName } from "./catalog.js";
import { encryptionKeyOf, hospitalKeyFor } from "./keys.js";
import { approvedList, nameOf, rootOf, updateInbox, useInbox } from "./store.js";
import {
  ActionButton, Card, ClaimSteps, EditButton, Empty, Field, Pill, PrivacyPanel, Seal, Summary, binder,
  dateOf, inputToSeconds, nowSeconds, rupees, secondsToInput, short, todayInput, useApp, useLoad,
} from "./ui.jsx";

const myAddress = (session) => session.address.toLowerCase();

// Sidebar sections; before registering there is only the registration form.
export function useHospitalSections() {
  const { session } = useApp();
  const inbox = useInbox();
  const overview = { id: "overview", label: "Overview", icon: LayoutDashboard };
  if (!inbox.hospitalKeys[myAddress(session)]) return { sections: [overview], initial: "overview" };
  return {
    sections: [overview, { id: "records", label: "Records", icon: FilePlus2 }, { id: "claims", label: "Claims", icon: ReceiptText }],
    initial: "overview",
  };
}

export default function Hospital({ section }) {
  const { session } = useApp();
  const inbox = useInbox();
  const me = myAddress(session);
  const root = useLoad(() => session.insureTrust.hospitalRoot(), [session]);
  if (!inbox.hospitalKeys[me]) return <div className="grid"><Identity /></div>;
  const list = approvedList(inbox);
  const approved = inbox.approvedHospitals.includes(me) && list.length > 0 && root.value === rootOf(list);
  const hasPatients = Object.values(inbox.people).some((p) => p.role === "patient" && p.profile);
  const hasPolicies = Object.values(inbox.policyShares).some((hs) => hs.includes(me));
  const hasClaims = Object.values(inbox.claims).some((c) => c.hospital === me);
  const gettingStarted = (
    <Card title="Getting started">
      <ol className="checklist-steps">
        <li className={approved ? "done" : ""}>The insurer approves your hospital</li>
        <li className={hasPatients ? "done" : ""}>A patient creates their health locker</li>
        <li className={hasPolicies ? "done" : ""}>The patient shares their insurance policy with you</li>
        <li>You write their medical record, then send the claim</li>
      </ol>
    </Card>
  );
  return (
    <div className="grid">
      {section === "overview" && <><Identity approved={approved} />{hasClaims ? <MyClaims /> : gettingStarted}</>}
      {section === "records" && (hasPatients ? <WriteRecord /> : (
        <Card title="Write a medical record" wide><Empty>No patients yet. Patients appear here once they create their health locker.</Empty></Card>
      ))}
      {section === "claims" && <>{approved && hasPolicies ? <PrepareClaim /> : gettingStarted}{hasClaims && <MyClaims wide />}</>}
    </div>
  );
}

const SAMPLE_HOSPITAL = { regNo: "CG/RPR/CE/2024/0147", city: "Raipur", state: "Chhattisgarh", phone: "+91 771 400 1234", nabh: "yes" };
const BLANK_HOSPITAL = { regNo: "", city: "", state: "", phone: "", nabh: "" };

function Identity({ approved }) {
  const { session } = useApp();
  const inbox = useInbox();
  const me = myAddress(session);
  const published = inbox.hospitalKeys[me];
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    name: nameOf(me) ?? "", ...(session.persona ? SAMPLE_HOSPITAL : BLANK_HOSPITAL),
    ...(published ? { regNo: published.regNo, city: published.city, state: published.state, phone: published.phone, nabh: published.nabh } : {}),
  }));
  const bind = binder(form, setForm);

  async function save() {
    const name = form.name.trim();
    if (!name) throw new Error("Enter the hospital's name.");
    if (!form.regNo.trim()) throw new Error("Enter the hospital's registration / licence number.");
    if (!form.city.trim()) throw new Error("Enter the city.");
    const details = { regNo: form.regNo.trim(), city: form.city.trim(), state: form.state.trim(), phone: form.phone.trim(), nabh: form.nabh };
    let key = published;
    if (!key) { const k = await hospitalKeyFor(session); key = { Ax: k.Ax, Ay: k.Ay }; } // one free wallet signature
    updateInbox((d) => {
      d.hospitalKeys[me] = { Ax: key.Ax, Ay: key.Ay, name, ...details };
      d.people[me] = { ...(d.people[me] ?? {}), name, role: "hospital" };
    });
    setEditing(false);
    return published ? "Details saved." : "Registered. The insurer can now review and approve your hospital.";
  }

  if (published && !editing) {
    return (
      <Card title="Your hospital" badge={<div className="actions-inline">{approved ? <Seal>approved by insurer</Seal> : <Pill tone="warn">Waiting for insurer approval</Pill>}<EditButton onClick={() => setEditing(true)} /></div>}>
        <Summary rows={[
          ["Name", published.name], ["Registration no.", published.regNo],
          ["NABH accredited", published.nabh === "yes" ? "Yes" : published.nabh === "no" ? "No" : ""],
          ["Location", [published.city, published.state].filter(Boolean).join(", ")], ["Phone", published.phone], ["Payout wallet", short(me)],
        ]} />
      </Card>
    );
  }
  return (
    <Card title={published ? "Edit hospital details" : "Register your hospital"}
      subtitle={published ? null : "The insurer checks these details before approving you. Your wallet signs once (free) to create your claim-signing key."}>
      <div className="form">
        <Field label="Hospital name"><input {...bind("name")} placeholder="e.g. City General Hospital" /></Field>
        <div className="row">
          <Field label="Registration / licence no." hint="Clinical Establishments Act registration"><input {...bind("regNo")} /></Field>
          <Field label="NABH accredited"><select {...bind("nabh")}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
        </div>
        <div className="row">
          <Field label="City"><input {...bind("city")} /></Field>
          <Field label="State"><input {...bind("state")} /></Field>
          <Field label="Phone"><input {...bind("phone")} /></Field>
        </div>
        <div className="actions-inline">
          <ActionButton action={save} busyLabel={published ? "Saving…" : "Registering (sign in your wallet)…"}>{published ? "Save" : "Register hospital"}</ActionButton>
          {published && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
      </div>
    </Card>
  );
}

const SAMPLE_RECORD = {
  doctor: "Dr. Neha Verma", doctorReg: "CGMC-2015-04412",
  notes: "Laparoscopic appendectomy under general anaesthesia. Uneventful recovery. Review after 7 days.",
  medications: "Amoxicillin 500 mg, 1-0-1, 5 days\nParacetamol 650 mg, when needed, 3 days",
  room: 12000, surgery: 25000, medicines: 3500, tests: 1500,
};
const BLANK_RECORD = { doctor: "", doctorReg: "", notes: "", medications: "", room: "", surgery: "", medicines: "", tests: "" };
const BILL_ITEMS = [["room", "Room & nursing"], ["surgery", "Procedure & surgeon fees"], ["medicines", "Medicines & consumables"], ["tests", "Lab & diagnostics"]];

function WriteRecord() {
  const { session, storage } = useApp();
  const inbox = useInbox();
  const me = myAddress(session);
  const patients = Object.entries(inbox.people).filter(([, p]) => p.role === "patient" && p.profile);
  const [form, setForm] = useState({
    patient: patients[0]?.[0] ?? "", diagnosis: DIAGNOSES[0].icd, procedure: DIAGNOSES[0].procedure,
    admitted: todayInput(-3), discharged: todayInput(-1), ...(session.persona ? SAMPLE_RECORD : BLANK_RECORD),
  });
  const bind = binder(form, setForm);
  const profile = inbox.people[form.patient]?.profile;
  const total = BILL_ITEMS.reduce((sum, [k]) => sum + Number(form[k] || 0), 0);
  const chooseDiagnosis = (e) => setForm({ ...form, diagnosis: e.target.value, procedure: DIAGNOSES.find((d) => d.icd === e.target.value).procedure });

  async function write() {
    const patient = form.patient;
    const patientName = nameOf(patient) ?? short(patient);
    if (form.discharged < form.admitted) throw new Error("The discharge date is before the admission date.");
    if (!form.doctor.trim()) throw new Error("Enter the treating doctor's name.");
    const bill = BILL_ITEMS.map(([k, item]) => ({ item, amount: Number(form[k] || 0) }));
    if (bill.some((b) => !Number.isFinite(b.amount) || b.amount < 0)) throw new Error("Bill amounts can't be negative.");
    if (total <= 0) throw new Error("Enter the bill amounts.");
    const totalPaise = BigInt(Math.round(total * 100)); // round: ₹1.15 × 100 is 114.99999… in floating point
    const patientKey = await encryptionKeyOf(session, patient);
    if (!patientKey) throw new Error(`${patientName} hasn't created their health locker yet.`);
    if (!(await session.healthRecords.canAddRecords(patient, me))) throw new Error(`${patientName} hasn't allowed your hospital to add records yet. They do this when they share their policy with you.`);
    const diagnosis = DIAGNOSES.find((d) => d.icd === form.diagnosis);
    const hospital = inbox.hospitalKeys[me];
    const billNo = `INV-${Date.now().toString().slice(-7)}`;
    const record = R.fhirRecord({
      patientRef: `p-${patient.slice(2, 10)}`, patientName, patient: profile ?? {},
      condition: diagnosis.name, conditionCode: diagnosis.icd,
      procedureCode: Number(form.procedure), procedureName: procedureName(form.procedure), date: form.admitted,
      admitted: form.admitted, discharged: form.discharged, notes: form.notes.trim(),
      doctor: { name: form.doctor.trim(), regNo: form.doctorReg.trim() },
      hospital: { name: hospital.name, regNo: hospital.regNo, city: hospital.city, state: hospital.state },
      medications: form.medications.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, frequency, duration] = l.split(",").map((s) => s.trim());
        return { name, frequency, duration };
      }),
      bill: bill.filter((b) => b.amount > 0), billNo,
    });
    const { ciphertext, key } = await R.encryptRecord(record); // locked in this browser
    const cid = await storage.put(ciphertext);
    const lockedForPatient = await R.wrapKey(key, patientKey);
    const receipt = await send(session.healthRecords.addRecord(patient, cid, R.bytesToHex(lockedForPatient)));
    // The hospital keeps its own case file (no diagnosis) so it can bill the insurer later.
    updateInbox((d) => {
      d.cases[billNo] = { billNo, hospital: me, patient: patient.toLowerCase(), procedureCode: Number(form.procedure), treatmentDate: inputToSeconds(form.discharged), billTotal: totalPaise, createdAt: nowSeconds() };
    });
    return { message: `Record locked and added to ${patientName}'s locker (bill ${billNo}, ${rupees(totalPaise)}). Only its fingerprint is on-chain.`, tx: receipt.hash };
  }

  return (
    <Card title="Write a medical record" subtitle="Discharge summary and bill. Encrypted in this browser so only the patient can open it." wide>
      <div className="form">
        <section className="form-section">
          <h4>Patient and stay</h4>
          <Field label="Patient" hint={profile && `ABHA ${profile.abha || "—"} · born ${profile.birthDate || "—"} · ${profile.gender || ""} · blood group ${profile.bloodGroup || "—"}`}>
            <select {...bind("patient")}>{patients.map(([a, p]) => <option key={a} value={a}>{p.name} ({short(a)})</option>)}</select>
          </Field>
          <div className="row">
            <Field label="Admitted"><input type="date" {...bind("admitted")} /></Field>
            <Field label="Discharged" hint="Used as the treatment date for the claim"><input type="date" {...bind("discharged")} /></Field>
          </div>
        </section>
        <section className="form-section">
          <h4>Diagnosis and treatment</h4>
          <div className="row">
            <Field label="Diagnosis (ICD-10)"><select value={form.diagnosis} onChange={chooseDiagnosis}>{DIAGNOSES.map((d) => <option key={d.icd} value={d.icd}>{d.name} ({d.icd})</option>)}</select></Field>
            <Field label="Procedure"><select {...bind("procedure")}>{PROCEDURES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          </div>
          <div className="row">
            <Field label="Treating doctor"><input {...bind("doctor")} placeholder="Dr. …" /></Field>
            <Field label="Doctor's registration no."><input {...bind("doctorReg")} /></Field>
          </div>
          <Field label="Prescriptions" hint="One per line: medicine and strength, dosage, duration"><textarea rows="3" {...bind("medications")} placeholder="Amoxicillin 500 mg, 1-0-1, 5 days" /></Field>
          <Field label="Clinical notes"><textarea rows="2" {...bind("notes")} /></Field>
        </section>
        <section className="form-section">
          <h4>Bill</h4>
          <div className="row">
            {BILL_ITEMS.map(([k, item]) => <Field key={k} label={`${item} (₹)`}><input type="number" min="0" step="0.01" {...bind(k)} placeholder="0" /></Field>)}
          </div>
          <dl className="bill-summary">
            {BILL_ITEMS.map(([k, item]) => Number(form[k]) > 0 && <Fragment key={k}><dt>{item}</dt><dd>{rupees(Math.round(Number(form[k]) * 100))}</dd></Fragment>)}
            <dt className="total">Bill total</dt><dd className="total">{rupees(Math.round(total * 100))}</dd>
          </dl>
        </section>
        <ActionButton action={write} busyLabel="Encrypting and saving…">Encrypt & add to patient's locker</ActionButton>
      </div>
    </Card>
  );
}

function PrepareClaim() {
  const { session } = useApp();
  const inbox = useInbox();
  const me = myAddress(session);
  const shared = Object.entries(inbox.policyShares).filter(([, hs]) => hs.includes(me)).map(([c]) => inbox.policies[c]).filter(Boolean);
  const cases = Object.values(inbox.cases).filter((c) => c.hospital === me && shared.some((p) => p.patient === c.patient)).sort((a, b) => Number(b.createdAt - a.createdAt));
  const [form, setForm] = useState({ policy: "", case: "", procedure: 4401, date: todayInput(-1), amount: session.persona ? 42000 : "" });
  const [stages, setStages] = useState(null); // live progress of the proof, with real timings
  // Runs one stage of the proof and records how long it really took.
  async function stage(label, fn) {
    setStages((s) => [...s, { label }]);
    const started = performance.now();
    const mark = (patch) => setStages((s) => s.map((x, i) => (i === s.length - 1 ? { ...x, ...patch } : x)));
    try { const result = await fn(); mark({ ms: Math.round(performance.now() - started) }); return result; }
    catch (e) { mark({ failed: true }); throw e; }
  }
  const bind = binder(form, setForm);
  const policy = inbox.policies[form.policy] ?? shared[0];
  const myKey = inbox.hospitalKeys[me];
  const list = approvedList(inbox);
  const paise = BigInt(Math.round(Number(form.amount || 0) * 100));
  const problems = policy && myKey
    ? C.claimProblems({ hospital: { leaf: C.hash([myKey.Ax, myKey.Ay, BigInt(me)]) }, hospitals: list, policy, procedureCode: form.procedure, claimDate: inputToSeconds(form.date), claimAmount: paise, claimSubmissionTime: nowSeconds() - 60n })
    : [];

  function pickCase(e) {
    const c = inbox.cases[e.target.value];
    if (!c) return setForm({ ...form, case: "" });
    const p = shared.find((p) => p.patient === c.patient);
    setForm({ ...form, case: c.billNo, policy: String(p.commitment), procedure: c.procedureCode, date: secondsToInput(c.treatmentDate), amount: Number(c.billTotal) / 100 });
  }

  async function prove() {
    if (problems.length) throw new Error(problems.join(" "));
    // Same bill -> same claim ID -> same one-time code, so the contract can never pay one bill twice.
    const claimId = await C.stableClaimId(me, form.case ? `bill:${form.case}` : `claim:${policy.commitment}:${form.procedure}:${inputToSeconds(form.date)}:${paise}`);
    const existing = inbox.claims[String(claimId)];
    if (existing?.status === "paid") throw new Error("This claim has already been paid.");
    if (existing?.status === "awaiting-patient") throw new Error("This claim is already waiting for the patient's approval.");
    setStages([]);
    await stage("Check the approved-hospital list on-chain", async () => {
      if (rootOf(list) !== (await session.insureTrust.hospitalRoot())) throw new Error("The approved-hospital list here doesn't match the blockchain. Ask the insurer to save it again.");
    });
    const input = await stage("Sign the claim with your hospital key", async () => C.buildClaim({
      hospital: await hospitalKeyFor(session), hospitals: list, policy, claimId, procedureCode: BigInt(form.procedure),
      claimDate: inputToSeconds(form.date), claimAmount: paise, claimSubmissionTime: nowSeconds() - 60n,
      chainId: BigInt(session.chainId), verifyingContract: session.deployment.insureTrust,
    }));
    const started = performance.now();
    const { proof, publicSignals } = await stage("Generate the zero-knowledge proof in this browser", () => C.proveClaim(input, "/zk/claim.wasm", "/zk/claim.zkey"));
    const ms = Math.round(performance.now() - started);
    const calldata = await stage("Package the proof for the smart contract", () => C.toCalldata(proof, publicSignals));
    updateInbox((d) => {
      d.claims[String(claimId)] = {
        id: String(claimId), patient: policy.patient, hospital: me, policyCommitment: policy.commitment, billNo: form.case || null,
        procedureCode: Number(form.procedure), claimDate: inputToSeconds(form.date), amount: paise,
        nullifier: input.claimNullifier, calldata, proofMs: ms, createdAt: nowSeconds(), status: "awaiting-patient",
      };
    });
    return `Zero-knowledge proof created in ${(ms / 1000).toFixed(1)} s and sent to ${nameOf(policy.patient) ?? "the patient"} for approval.`;
  }

  return (
    <Card title="Prepare an insurance claim" subtitle="Your browser creates a zero-knowledge proof that the claim follows the policy, without revealing the diagnosis, procedure or date to the insurer" wide>
      <div className="two-col">
        <div className="form">
          {cases.length > 0 && (
            <Field label="Treatment case" hint="Fills the claim from your bill">
              <select value={form.case} onChange={pickCase}>
                <option value="">Select a bill</option>
                {cases.map((c) => <option key={c.billNo} value={c.billNo}>{nameOf(c.patient) ?? short(c.patient)} · {procedureName(c.procedureCode)} · {c.billNo} · {rupees(c.billTotal)}</option>)}
              </select>
            </Field>
          )}
          <Field label="Patient's policy">
            <select value={String(policy?.commitment ?? "")} onChange={bind("policy").onChange}>
              {shared.map((p) => <option key={String(p.commitment)} value={String(p.commitment)}>{nameOf(p.patient) ?? short(p.patient)} · {policyNumber(p)} · {p.plan} · limit {rupees(p.policyLimit)}</option>)}
            </select>
          </Field>
          {policy && <p className="muted small">Policy period {dateOf(policy.policyStart)} → {dateOf(policy.policyExpiry)}. Covers: {policy.coveredProcedures.map(procedureName).join(", ")}.</p>}
          <div className="row">
            <Field label="Procedure"><select {...bind("procedure")}>{PROCEDURES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
            <Field label="Treatment date"><input type="date" {...bind("date")} /></Field>
          </div>
          <Field label="Amount (₹)"><input type="number" min="1" {...bind("amount")} /></Field>
          {problems.length > 0 ? (
            <div className="problems"><b>This claim can't be proved:</b><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
          ) : policy && <p className="ok"><Check /><span>All policy rules pass. Ready to create the proof.</span></p>}
          {stages && stages.length > 0 && (
            <ol className="proof-steps" aria-live="polite">
              {stages.map((s) => (
                <li key={s.label} className={s.failed ? "failed" : s.ms !== undefined ? "done" : "active"}>
                  {s.failed ? <AlertCircle /> : s.ms !== undefined ? <Check /> : <span className="spinner" />}
                  <span>{s.label}</span>
                  <span className="proof-time">{s.ms !== undefined ? `${(s.ms / 1000).toFixed(2)} s` : ""}</span>
                </li>
              ))}
            </ol>
          )}
          <ActionButton action={prove} busyLabel="Creating zero-knowledge proof…" disabled={!policy || problems.length > 0}>Create proof & send to patient</ActionButton>
        </div>
        <PrivacyPanel
          publicItems={[`Amount: ${rupees(paise)}`, "Policy fingerprint", "Your payout wallet", "One-time claim code"]}
          privateItems={[`Procedure: ${procedureName(form.procedure)}`, `Treatment date: ${form.date}`, "Diagnosis, prescriptions, bill items", "Policy limit & covered list"]}
        />
      </div>
    </Card>
  );
}

const STATUS = { "awaiting-patient": ["warn", "Waiting for patient"], paid: ["ok", "Paid"], rejected: ["bad", "Rejected"], declined: ["bad", "Declined by patient"] };
export const ClaimStatus = ({ status }) => <Pill tone={STATUS[status]?.[0] ?? "info"}>{STATUS[status]?.[1] ?? status}</Pill>;

function MyClaims({ wide }) {
  const { session } = useApp();
  const inbox = useInbox();
  const mine = Object.values(inbox.claims).filter((c) => c.hospital === myAddress(session)).sort((a, b) => Number(b.createdAt - a.createdAt));
  return (
    <Card title="Claims you sent" wide={wide}>
      <ul className="list">
        {mine.map((c) => (
          <li key={c.id} className="stack">
            <div className="list-row">
              <div><b>{nameOf(c.patient) ?? short(c.patient)}</b> · {procedureName(c.procedureCode)} · {rupees(c.amount)}<div className="muted small">{c.billNo ? `Bill ${c.billNo} · ` : ""}Proof made in {(c.proofMs / 1000).toFixed(1)} s{c.reason ? ` · ${c.reason}` : ""}</div></div>
              <ClaimStatus status={c.status} />
            </div>
            <ClaimSteps status={c.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
