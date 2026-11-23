// Patient screen: Home (to-dos + tiles), and pages for records (open / share / revoke / history),
// insurance, claim approval and personal details.
import { Fragment, useState } from "react";
import { getAddress } from "ethers";
import { AlertCircle, Check, FolderLock, ReceiptText, ShieldCheck, UserRound } from "lucide-react";
import * as R from "../../lib/records.js";
import { eventsOf, explainError, revertName, send, txUrl } from "./chain.js";
import { BLOOD_GROUPS, PROCEDURES, policyNumber, procedureName } from "./catalog.js";
import { ClaimStatus } from "./Hospital.jsx";
import { encryptionKeyOf, publishEncryptionKey, recordKeysFor } from "./keys.js";
import RecordView from "./RecordView.jsx";
import { approvedList, downloadJson, downloadText, nameOf, rootOf, updateInbox, useInbox } from "./store.js";
import {
  ActionButton, Card, ClaimSteps, EditButton, Empty, ErrorNote, Field, Kpi, Loading, Pill, PrivacyPanel, Receipt, Summary, Todo, Who, ago, binder,
  dateOf, dateTimeOf, inputToSeconds, nowSeconds, rupees, secondsToInput, short, todayInput, useApp, useLoad,
} from "./ui.jsx";

// ---------- the patient's own records, unlocked in this browser ----------
// Each record's key is locked for the patient; one free wallet signature unlocks them all.
// A record whose file isn't reachable here (e.g. made in another browser on the hosted site) is
// returned with an error instead of stopping the rest.
async function unlockMyRecords(session, storage) {
  const hr = session.healthRecords;
  const keys = await recordKeysFor(session);
  const ids = [...(await hr.recordsOf(session.address))];
  return Promise.all(ids.map(async (id) => {
    const onChain = await hr.records(id);
    try {
      const key = await R.unwrapKey(R.hexToBytes(await hr.keyFor(id, session.address)), keys);
      const fhir = await R.decryptRecord(await storage.get(onChain.cid), key);
      return { id, issuer: onChain.issuer, fhir, ...factsOf(fhir) };
    } catch (e) {
      return { id, issuer: onChain.issuer, error: explainError(e) };
    }
  }));
}

// Plain facts from one FHIR record (the same shape the hospital writes in lib/records.js).
function factsOf(fhir) {
  const all = (type) => fhir.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
  const [cond] = all("Condition"), [proc] = all("Procedure"), [enc] = all("Encounter"), [org] = all("Organization"), [inv] = all("Invoice");
  const coding = proc?.code?.coding?.[0];
  return {
    diagnosis: cond?.code?.text, icd: cond?.code?.coding?.[0]?.code,
    procedureCode: coding?.code, procedureName: coding?.display,
    admitted: enc?.period?.start ?? proc?.performedDateTime, discharged: enc?.period?.end,
    hospital: org?.name,
    medicines: all("MedicationRequest").map((m) => m.medicationCodeableConcept?.text).filter(Boolean),
    billNo: inv?.identifier?.[0]?.value,
    bill: inv ? inv.lineItem.map((l) => ({ item: l.chargeItemCodeableConcept.text, rupees: l.priceComponent[0].amount.value })) : [],
    billTotal: inv?.totalGross?.value, // rupees
  };
}

// Home: what needs the patient (claims to approve, a policy to share), then tiles for each page.
export function PatientHome({ go }) {
  const { session } = useApp();
  const inbox = useInbox();
  const me = lower(session);
  const key = useLoad(() => encryptionKeyOf(session, session.address), [session]);
  const activity = useLoad(() => recordActivity(session), [session]);
  if (key.value === undefined) return key.error ? <ErrorNote>{key.error}</ErrorNote> : <Loading />;
  if (key.value === null) return <div className="grid"><Locker published={false} /></div>; // first visit: create the locker
  const claims = Object.values(inbox.claims).filter((c) => c.patient === me);
  const waiting = claims.filter((c) => c.status === "awaiting-patient");
  const paid = claims.filter((c) => c.status === "paid").length;
  const policies = Object.values(inbox.policies).filter((p) => p.patient === me);
  const unshared = policies.filter((p) => !(inbox.policyShares[String(p.commitment)]?.length));
  const now = nowSeconds();
  const todos = [
    ...waiting.map((c) => ({
      text: `Approve claim ${rupees(c.amount)} from ${nameOf(c.hospital) ?? short(c.hospital)}`,
      detail: `${procedureName(c.procedureCode)} on ${dateOf(c.claimDate)}. The contract checks the proof and pays the hospital.`,
      onClick: () => go("claims"),
    })),
    ...unshared.map((p) => ({ text: `Share your ${p.plan} policy with a hospital`, detail: "So it can add your records and prepare claims", onClick: () => go("insurance") })),
    // Reminders: a doctor's access about to end, and a policy about to end (or already ended).
    ...(activity.value?.ending ?? []).map((a) => ({
      text: `${nameOf(a.who) ?? short(a.who)}'s access to record #${a.id} ends ${dateOf(a.expiresAt)}`,
      detail: "Share it again to extend, or let it end", onClick: () => go("records"),
    })),
    ...policies.filter((p) => p.policyExpiry > now && p.policyExpiry - now < 30n * DAY).map((p) => ({
      text: `Your ${p.plan} policy ends on ${dateOf(p.policyExpiry)}`, detail: "Treatment after that date can't be claimed", onClick: () => go("insurance"),
    })),
    ...policies.filter((p) => p.policyExpiry <= now).map((p) => ({
      text: `Your ${p.plan} policy has ended`, detail: `It covered treatment until ${dateOf(p.policyExpiry)}`, onClick: () => go("insurance"),
    })),
  ];
  return (
    <div className="grid">
      <Todo items={todos} />
      <div className="kpis wide">
        <Kpi icon={FolderLock} label="Records" value={activity.value ? activity.value.count : "…"} note="encrypted, only you hold the key" onClick={() => go("records")} />
        <Kpi icon={ShieldCheck} label="Insurance" value={policies[0]?.plan ?? "None yet"} onClick={() => go("insurance")}
          note={policies[0] ? `limit ${rupees(policies[0].policyLimit)} per claim` : "the insurer issues your policy"} />
        <Kpi icon={ReceiptText} label="Claims" value={`${paid} paid`} note={waiting.length ? `${waiting.length} waiting for you` : "the contract pays the hospital"} onClick={() => go("claims")} />
        <Kpi icon={UserRound} label="My details" value={inbox.people[me]?.name ?? "Add details"} note="kept off the blockchain" onClick={() => go("profile")} />
      </div>
      <Card title="Recent activity" subtitle="Who opened your records, from the access log on the blockchain" wide>
        {!activity.value ? (activity.error ? <ErrorNote>{activity.error}</ErrorNote> : <Loading />) : activity.value.views.length === 0 ? (
          <Empty>No one has opened your records yet.</Empty>
        ) : (
          <ul className="activity">
            {activity.value.views.map((v) => (
              <li key={v.tx}>
                <span><Who address={v.who} /> opened record #{String(v.id)}</span>
                <span className="muted small">{ago(v.time)}{txUrl(session, v.tx) && <> · <a href={txUrl(session, v.tx)} target="_blank" rel="noreferrer">tx ↗</a></>}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const DAY = 86_400n;
const ENDING_SOON = 3 * 86_400; // remind the patient this long before a doctor's access ends

// From the on-chain log of the patient's records: how many there are, the latest opens by others,
// and doctors whose access ends soon (their latest grant, not revoked since, expiring within 3 days).
async function recordActivity(session) {
  const hr = session.healthRecords;
  const me = lower(session);
  const ids = [...(await hr.recordsOf(session.address))];
  if (ids.length === 0) return { count: 0, views: [], ending: [] };
  const [granted, revoked, viewed] = await Promise.all([
    eventsOf(session, hr, hr.filters.AccessGranted(ids)),
    eventsOf(session, hr, hr.filters.AccessRevoked(ids)),
    eventsOf(session, hr, hr.filters.RecordViewed(ids)),
  ]);
  const views = await Promise.all(viewed.filter((e) => e.args.viewer.toLowerCase() !== me).slice(-5).reverse()
    .map(async (e) => ({ who: e.args.viewer, id: e.args.recordId, tx: e.transactionHash, time: (await e.getBlock()).timestamp })));
  const latest = new Map(); // "record:person" -> that person's latest grant or revoke
  for (const e of [...granted, ...revoked].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)) {
    latest.set(`${e.args.recordId}:${e.args.grantee.toLowerCase()}`, e);
  }
  const now = Date.now() / 1000;
  const ending = [...latest.values()]
    .filter((e) => e.fragment.name === "AccessGranted" && e.args.grantee.toLowerCase() !== me && e.args.expiresAt > 0n)
    .filter((e) => Number(e.args.expiresAt) > now && Number(e.args.expiresAt) - now < ENDING_SOON)
    .map((e) => ({ who: e.args.grantee, id: e.args.recordId, expiresAt: e.args.expiresAt }));
  return { count: ids.length, views, ending };
}

export default function Patient({ section }) {
  const { session } = useApp();
  const inbox = useInbox();
  const key = useLoad(() => encryptionKeyOf(session, session.address), [session]);
  if (key.value === undefined) return key.error ? <ErrorNote>{key.error}</ErrorNote> : <Loading />;
  if (key.value === null) return <div className="grid"><Locker published={false} /></div>;
  const mine = Object.values(inbox.claims).filter((c) => c.patient === lower(session));
  const waiting = mine.some((c) => c.status === "awaiting-patient");
  const done = mine.some((c) => c.status !== "awaiting-patient");
  return (
    <div className="grid">
      {section === "records" && <><Records /><Timeline /></>}
      {section === "insurance" && <><Policies /><CoverageCheck /></>}
      {section === "claims" && <>
        {waiting && <ClaimApprovals />}
        {done && <ClaimHistory />}
        {!waiting && !done && <Card title="Claims" wide><Empty>No claims yet. When a hospital sends one, you approve it here and the contract pays the hospital.</Empty></Card>}
      </>}
      {section === "profile" && <Locker published />}
    </div>
  );
}

const lower = (session) => session.address.toLowerCase();

// Fictional sample details, used only for the local demo people.
const SAMPLE_PROFILE = { birthDate: "1994-06-12", gender: "male", phone: "+91 98765 43210", abha: "91-4821-7730-5519", bloodGroup: "B+", emergencyContact: "Sunita (mother), +91 98260 11223" };
const BLANK_PROFILE = { birthDate: "", gender: "", phone: "", abha: "", bloodGroup: "", emergencyContact: "" };

function Locker({ published }) {
  const { session } = useApp();
  const inbox = useInbox();
  const me = lower(session);
  const person = inbox.people[me];
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({ name: person?.name ?? "", ...(session.persona ? SAMPLE_PROFILE : BLANK_PROFILE), ...(person?.profile ?? {}) }));
  const bind = binder(form, setForm);
  const p = person?.profile ?? {};

  async function save() {
    const name = form.name.trim();
    if (!name) throw new Error("Enter your full name.");
    if (!form.birthDate || !form.gender) throw new Error("Enter your date of birth and gender.");
    if (form.abha && !/^\d{2}-?\d{4}-?\d{4}-?\d{4}$/.test(form.abha.trim())) throw new Error("The ABHA number has 14 digits, e.g. 91-1234-5678-9012.");
    const { name: _name, ...profile } = form;
    if (!published) await publishEncryptionKey(session); // one wallet signature + one transaction
    updateInbox((d) => { d.people[me] = { ...(d.people[me] ?? {}), name, role: "patient", profile }; });
    setEditing(false);
    return published ? "Details saved." : "Your health locker is ready.";
  }

  if (published && !editing) {
    return (
      <Card title="My details" subtitle="Kept off the blockchain. Hospitals copy them into your encrypted records." badge={<EditButton onClick={() => setEditing(true)} />}>
        <Summary rows={[["Name", person?.name], ["Date of birth", p.birthDate], ["Gender", p.gender], ["Blood group", p.bloodGroup], ["ABHA number", p.abha], ["Mobile", p.phone], ["Emergency contact", p.emergencyContact]]} />
      </Card>
    );
  }
  return (
    <Card title={published ? "Edit my details" : "Create your health locker"}
      subtitle={published ? "Kept off the blockchain" : "Hospitals will add your records here, encrypted so only you can open them. Your wallet asks for one signature and one transaction."}>
      <div className="form">
        <div className="row">
          <Field label="Full name"><input {...bind("name")} placeholder="As on your ID" /></Field>
          <Field label="Date of birth"><input type="date" {...bind("birthDate")} /></Field>
        </div>
        <div className="row">
          <Field label="Gender"><select {...bind("gender")}><option value="">Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></Field>
          <Field label="Blood group"><select {...bind("bloodGroup")}><option value="">Select</option>{BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}</select></Field>
        </div>
        <div className="row">
          <Field label="ABHA number" hint="Ayushman Bharat Health Account ID (optional)"><input {...bind("abha")} placeholder="91-1234-5678-9012" /></Field>
          <Field label="Mobile"><input {...bind("phone")} placeholder="+91 …" /></Field>
        </div>
        <Field label="Emergency contact"><input {...bind("emergencyContact")} placeholder="Name, relation, phone" /></Field>
        <div className="actions-inline">
          <ActionButton action={save} busyLabel={published ? "Saving…" : "Creating (confirm in your wallet)…"}>{published ? "Save" : "Create my health locker"}</ActionButton>
          {published && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
      </div>
    </Card>
  );
}

// Contract answers that mean this proof can never be paid (the hospital must make a new one).
const FINAL_ERRORS = new Set(["InvalidProof", "WrongDeployment", "UnknownHospitalRoot", "BadSubmissionTime", "NotPolicyHolder"]);

function ClaimApprovals() {
  const { session } = useApp();
  const inbox = useInbox();
  const waiting = Object.values(inbox.claims).filter((c) => c.patient === lower(session) && c.status === "awaiting-patient");

  async function submit(claim) {
    try {
      const [a, b, c, pub] = claim.calldata;
      const receipt = await send(session.insureTrust.submitClaim(a, b, c, pub));
      updateInbox((d) => Object.assign(d.claims[claim.id], { status: "paid", txHash: receipt.hash, settledAt: nowSeconds() }));
      return { message: `Paid. ${rupees(claim.amount)} (test tINR) went straight to the hospital.`, tx: receipt.hash };
    } catch (e) {
      // Only a final answer from the contract closes the claim. No gas, an empty pool or a network
      // error can be fixed, so the claim stays here to try again.
      const name = revertName(e);
      if (name === "AlreadyPaid") updateInbox((d) => Object.assign(d.claims[claim.id], { status: "paid", reason: "Paid by an earlier submission." }));
      else if (FINAL_ERRORS.has(name)) updateInbox((d) => Object.assign(d.claims[claim.id], { status: "rejected", reason: explainError(e) }));
      throw e;
    }
  }

  return (
    <Card wide title="Claims waiting for your approval" subtitle="A hospital prepared these. When you approve, the smart contract checks the proof and pays the hospital automatically."
      badge={waiting.length > 0 && <Pill tone="warn">{waiting.length} waiting</Pill>}>
      {waiting.length === 0 ? <Empty>Nothing waiting.</Empty> : (
        <ul className="list">
          {waiting.map((c) => (
            <li key={c.id} className="stack">
              <div className="list-row">
                <div><b>{rupees(c.amount)}</b> to <Who address={c.hospital} /><div className="muted small">{c.billNo ? `Bill ${c.billNo} · ` : ""}{procedureName(c.procedureCode)} on {dateOf(c.claimDate)} · proof made in {(c.proofMs / 1000).toFixed(1)} s</div></div>
              </div>
              <ClaimSteps status={c.status} />
              <PrivacyPanel
                publicItems={[`Amount ${rupees(c.amount)}`, "Your policy fingerprint", "Hospital's payout wallet"]}
                privateItems={[procedureName(c.procedureCode), `Treatment date ${dateOf(c.claimDate)}`, "Your diagnosis and records"]}
              />
              <BillCheck claim={c} />
              <div className="actions-inline">
                <ActionButton action={() => submit(c)} busyLabel="Submitting proof to the contract…">Approve & submit claim</ActionButton>
                <ActionButton tone="ghost" action={async () => { updateInbox((d) => { d.claims[c.id].status = "declined"; }); return "Declined."; }}>Decline</ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// The insurer never sees the bill (that's the point of the proof), so the patient is the one person
// who can catch overbilling: compare the claim with the bill inside their own encrypted record.
function BillCheck({ claim }) {
  const { session, storage } = useApp();
  const [result, setResult] = useState(null);

  async function check() {
    const mine = await unlockMyRecords(session, storage);
    const rec = claim.billNo && mine.find((r) => r.billNo === claim.billNo);
    if (!rec) {
      throw new Error(claim.billNo
        ? `Bill ${claim.billNo} isn't in the records this browser can open, so it can't be checked. Ask the hospital before approving.`
        : "This claim isn't linked to a bill in your records, so it can't be checked. Ask the hospital before approving.");
    }
    const billPaise = BigInt(Math.round(Number(rec.billTotal) * 100));
    const diff = claim.amount - billPaise;
    const checks = [
      { ok: diff <= 0n, text: diff === 0n ? `Amount ${rupees(claim.amount)} matches your bill`
        : diff < 0n ? `Amount ${rupees(claim.amount)} is less than your bill (${rupees(billPaise)})`
        : `Amount is ${rupees(diff)} more than your bill (claim ${rupees(claim.amount)}, bill ${rupees(billPaise)})` },
      { ok: String(claim.procedureCode) === String(rec.procedureCode), text: String(claim.procedureCode) === String(rec.procedureCode)
        ? `Procedure matches your record: ${procedureName(claim.procedureCode)}`
        : `Procedure differs: the claim says ${procedureName(claim.procedureCode)}, your record says ${rec.procedureName ?? rec.procedureCode}` },
      { ok: secondsToInput(claim.claimDate) === rec.discharged, text: secondsToInput(claim.claimDate) === rec.discharged
        ? `Treatment date matches your discharge date (${rec.discharged})`
        : `Date differs: the claim says ${secondsToInput(claim.claimDate)}, your discharge date is ${rec.discharged ?? "missing"}` },
    ];
    setResult({ rec, checks });
    return checks.every((c) => c.ok) ? "Everything matches your own bill." : "Something doesn't match your bill. Read it before approving.";
  }

  if (!result) return <ActionButton small tone="ghost" action={check} busyLabel="Unlocking your record…">Check against my bill</ActionButton>;
  return (
    <div className="bill-check">
      <ul className="checks">
        {result.checks.map((c) => <li key={c.text} className={c.ok ? "ok" : "bad"}>{c.ok ? <Check /> : <AlertCircle />}<span>{c.text}</span></li>)}
      </ul>
      <details>
        <summary>Your bill {result.rec.billNo} from {result.rec.hospital ?? "the hospital"}</summary>
        <dl className="bill-summary">
          {result.rec.bill.map((b) => <Fragment key={b.item}><dt>{b.item}</dt><dd>{rupees(Math.round(b.rupees * 100))}</dd></Fragment>)}
          <dt className="total">Bill total</dt><dd className="total">{rupees(Math.round(Number(result.rec.billTotal) * 100))}</dd>
        </dl>
      </details>
    </div>
  );
}

function Records() {
  const { session, storage } = useApp();
  const inbox = useInbox();
  const me = session.address;
  const data = useLoad(async () => {
    const hr = session.healthRecords;
    const ids = [...(await hr.recordsOf(me))].reverse();
    if (ids.length === 0) return { root: null, rows: [] };
    // One history query per event type for ALL my records (not three per record).
    const [root, allGranted, allRevoked, allViewed] = await Promise.all([
      session.insureTrust.hospitalRoot(),
      eventsOf(session, hr, hr.filters.AccessGranted(ids)),
      eventsOf(session, hr, hr.filters.AccessRevoked(ids)),
      eventsOf(session, hr, hr.filters.RecordViewed(ids)),
    ]);
    const blockTimes = new Map(); // many events share a block: fetch each block's time once
    const timeOf = (e) => {
      if (!blockTimes.has(e.blockNumber)) blockTimes.set(e.blockNumber, e.getBlock().then((b) => b.timestamp));
      return blockTimes.get(e.blockNumber);
    };
    const rows = await Promise.all(ids.map(async (id) => {
      const mineOnly = (events) => events.filter((e) => e.args.recordId === id);
      const [record, granted, revoked, viewed] = [await hr.records(id), mineOnly(allGranted), mineOnly(allRevoked), mineOnly(allViewed)];
      const others = [...new Set(granted.map((g) => g.args.grantee))].filter((a) => a.toLowerCase() !== me.toLowerCase());
      const access = await Promise.all(others.map(async (address) => ({
        address, active: await hr.hasAccess(id, address), expiresAt: granted.filter((g) => g.args.grantee === address).at(-1).args.expiresAt,
      })));
      const events = [
        ...granted.filter((g) => g.args.grantee.toLowerCase() !== me.toLowerCase()).map((e) => ({ e, text: "Access given to", who: e.args.grantee })),
        ...revoked.map((e) => ({ e, text: "Access removed for", who: e.args.grantee })),
        ...viewed.map((e) => ({ e, text: "Opened by", who: e.args.viewer })),
      ].sort((a, b) => a.e.blockNumber - b.e.blockNumber || a.e.index - b.e.index);
      const history = await Promise.all(events.map(async (h) => ({ ...h, time: await timeOf(h.e) })));
      return { id, record, access, history };
    }));
    return { root, rows };
  }, [session]);
  // Anyone can add a record to a locker (the contract doesn't restrict it), so flag records whose
  // sender isn't on the approved-hospital list, and trust that list only if it matches the on-chain root.
  const list = approvedList(inbox);
  // Only judge senders when this browser holds the insurer's list and it matches the chain.
  const knowsList = Boolean(data.value) && list.length > 0 && rootOf(list) === data.value.root;
  const approvedSenders = new Set(knowsList ? list.map((h) => h.address) : []);
  const [opened, setOpened] = useState({});

  async function open(id, cid) {
    const keys = await recordKeysFor(session);
    const recordKey = await R.unwrapKey(R.hexToBytes(await session.healthRecords.keyFor(id, me)), keys);
    const record = await R.decryptRecord(await storage.get(cid), recordKey);
    setOpened((o) => ({ ...o, [id]: record }));
    return "Decrypted in your browser.";
  }

  return (
    <Card title="My medical records" subtitle="Each record is stored encrypted off-chain. The blockchain only holds its fingerprint and who may open it." wide>
      {data.loading && !data.value ? <Loading /> : data.error ? <ErrorNote>{data.error}</ErrorNote> : data.value.rows.length === 0 ? (
        <Empty>No records yet. A hospital adds them after a visit (Hospital tab → Write a medical record).</Empty>
      ) : (
        <ul className="list">
          {data.value.rows.map(({ id, record, access, history }) => (
            <li key={String(id)} className="stack">
              <div className="list-row">
                <div>
                  <b>Record #{String(id)}</b> from <Who address={record.issuer} /> · {dateOf(record.createdAt)}
                  {knowsList && !approvedSenders.has(record.issuer.toLowerCase()) && <> <Pill tone="warn">not from an approved hospital</Pill></>}
                  <div className="muted small">
                    Locked file <code>{short(record.cid)}</code>
                    {storage.viewUrl && <> · <a href={storage.viewUrl(record.cid)} target="_blank" rel="noreferrer">see what IPFS stores ↗</a></>}
                  </div>
                </div>
                <ActionButton small busyLabel="Decrypting…" action={() => open(id, record.cid)}>Open</ActionButton>
              </div>
              {opened[id] && <RecordView record={opened[id]} />}
              <AccessList id={id} access={access} />
              <ShareRecord id={id} />
              {history.length > 0 && (
                <details>
                  <summary>Access history ({history.length})</summary>
                  <ul className="history">{history.map((h) => <li key={`${h.e.transactionHash}-${h.e.index}`}>{dateTimeOf(h.time)} · {h.text} <Who address={h.who} /></li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AccessList({ id, access }) {
  const { session } = useApp();
  if (access.length === 0) return null;
  return (
    <ul className="access">
      {access.map((a) => (
        <li key={a.address}>
          <Who address={a.address} />{" "}
          {a.active ? <Pill tone="ok">can open{a.expiresAt > 0n ? ` until ${dateOf(a.expiresAt)}` : ""}</Pill> : <Pill tone="bad">no access</Pill>}
          {a.active && <ActionButton small tone="ghost" busyLabel="Revoking…" action={async () => ({
            message: "Access removed. (It can't erase a copy they already saw.)",
            tx: (await send(session.healthRecords.revokeAccess(id, a.address))).hash,
          })}>Revoke</ActionButton>}
        </li>
      ))}
    </ul>
  );
}

function ShareRecord({ id }) {
  const { session } = useApp();
  const inbox = useInbox();
  const me = lower(session);
  const people = Object.entries(inbox.people).filter(([a, p]) => a !== me && p.role === "doctor");
  const [to, setTo] = useState(people[0]?.[0] ?? "");
  const [days, setDays] = useState(7);

  async function share() {
    let address;
    try { address = getAddress(to.trim()); } catch { throw new Error("Pick a person or enter a wallet address (0x…)."); }
    const who = nameOf(address) ?? short(address);
    const theirKey = await encryptionKeyOf(session, address);
    if (!theirKey) throw new Error(`${who} hasn't published an encryption key yet (Hospital tab → Doctor section → Publish my encryption key).`);
    const keys = await recordKeysFor(session);
    const recordKey = await R.unwrapKey(R.hexToBytes(await session.healthRecords.keyFor(id, session.address)), keys);
    const lockedForThem = await R.wrapKey(recordKey, theirKey); // only their private key can open this
    const expires = Number(days) > 0 ? nowSeconds() + BigInt(Math.round(Number(days) * 86_400)) : 0n;
    const receipt = await send(session.healthRecords.grantAccess(id, address, R.bytesToHex(lockedForThem), expires));
    return { message: `${who} can open this record ${expires ? `until ${dateOf(expires)}` : "until you revoke it"}.`, tx: receipt.hash };
  }

  return (
    <div className="share">
      <Field label="Share with a doctor" hint={nameOf(to) ? `= ${nameOf(to)}` : "Pick a doctor or paste their wallet address"}>
        <input list={`people-${id}`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x… wallet address" />
        <datalist id={`people-${id}`}>{people.map(([a, p]) => <option key={a} value={a}>{p.name} ({p.details?.specialty ?? p.role})</option>)}</datalist>
      </Field>
      <Field label="For (days)" hint="0 = until I revoke"><input type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      <ActionButton small action={share} busyLabel="Sharing…">Share</ActionButton>
    </div>
  );
}

function Policies() {
  const { session } = useApp();
  const inbox = useInbox();
  const me = lower(session);
  const mine = Object.values(inbox.policies).filter((p) => p.patient === me);
  const hospitals = approvedList(inbox).map((h) => [h.address, h]);
  const holders = useLoad(async () => Object.fromEntries(await Promise.all(mine.map(async (p) => [String(p.commitment), await session.insureTrust.policyHolder(p.commitment)]))), [session, mine.length]);
  const [pick, setPick] = useState({});

  return (
    <Card wide title="My insurance" subtitle="Your policy files (from the insurer). Share one with a hospital so it can prepare claims for you.">
      {mine.length === 0 ? <Empty>No policy yet. The insurer issues one (Insurer tab → Issue a policy).</Empty> : (
        <ul className="list">
          {mine.map((p) => {
            const key = String(p.commitment);
            const holder = holders.value?.[key];
            const revoked = holder !== undefined && holder.toLowerCase() !== me;
            const expired = nowSeconds() >= p.policyExpiry;
            const sharedWith = inbox.policyShares[key] ?? [];
            const hospital = pick[key] ?? hospitals[0]?.[0] ?? "";
            return (
              <li key={key} className="stack">
                <div className="list-row">
                  <div><b>{p.plan}</b> · {policyNumber(p)} · limit {rupees(p.policyLimit)} per claim<div className="muted small">{dateOf(p.policyStart)} → {dateOf(p.policyExpiry)} · covers {p.coveredProcedures.map(procedureName).join(", ")}</div></div>
                  <Pill tone={revoked ? "bad" : expired ? "warn" : "ok"}>{revoked ? "Revoked" : expired ? "Expired" : "Active"}</Pill>
                </div>
                {sharedWith.length > 0 && <div className="muted small">Shared with: {sharedWith.map((h) => nameOf(h) ?? short(h)).join(", ")}</div>}
                <div className="actions-inline">
                  {hospitals.length === 0 ? <span className="muted small">No approved hospitals yet.</span> : (
                    <>
                      <select value={hospital} onChange={(e) => setPick({ ...pick, [key]: e.target.value })}>{hospitals.map(([a, h]) => <option key={a} value={a}>{h.name}</option>)}</select>
                      <ActionButton small busyLabel="Sharing (confirm in your wallet)…" action={async () => {
                        // On-chain: this hospital may now add records to my locker (nobody else can).
                        const allowed = await session.healthRecords.canAddRecords(session.address, hospital);
                        const receipt = allowed ? null : await send(session.healthRecords.setRecordWriter(hospital, true));
                        updateInbox((d) => { const list = (d.policyShares[key] ??= []); if (!list.includes(hospital)) list.push(hospital); });
                        const who = nameOf(hospital) ?? short(hospital);
                        return { message: `Policy file handed to ${who} (simulated), and ${who} may now add records to your locker. They can now prepare claims for you.`, tx: receipt?.hash };
                      }}>Share with hospital</ActionButton>
                    </>
                  )}
                  <button className="btn ghost small" onClick={() => downloadJson(`policy-${key.slice(0, 8)}.json`, p)}>Download policy file</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// All the patient's records in date order, unlocked only in this browser, plus two downloads:
// the records as one standard FHIR file, and the on-chain access history as a spreadsheet (CSV).
function Timeline() {
  const { session, storage } = useApp();
  const [items, setItems] = useState(null);
  const unlockAll = async () => {
    const all = (await unlockMyRecords(session, storage)).sort((a, b) => String(b.admitted ?? "").localeCompare(String(a.admitted ?? "")));
    setItems(all);
    return all;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  async function show() {
    return `${plural((await unlockAll()).length, "record")} unlocked in your browser.`;
  }
  async function downloadRecords() {
    const ok = (items ?? (await unlockAll())).filter((r) => r.fhir);
    if (ok.length === 0) throw new Error("No records could be unlocked in this browser, so there's nothing to download.");
    downloadJson("my-health-records.fhir.json", { resourceType: "Bundle", type: "collection", timestamp: new Date().toISOString(), entry: ok.map((r) => ({ resource: r.fhir })) });
    return `Downloaded ${plural(ok.length, "record")} as a FHIR file.`;
  }
  async function downloadHistory() {
    const hr = session.healthRecords;
    const ids = [...(await hr.recordsOf(session.address))];
    if (ids.length === 0) throw new Error("You have no records yet, so there's no access history.");
    const [granted, revoked, viewed] = await Promise.all([
      eventsOf(session, hr, hr.filters.AccessGranted(ids)),
      eventsOf(session, hr, hr.filters.AccessRevoked(ids)),
      eventsOf(session, hr, hr.filters.RecordViewed(ids)),
    ]);
    const rows = [
      ...granted.map((e) => [e, "Access given", e.args.grantee, e.args.expiresAt > 0n ? `until ${dateOf(e.args.expiresAt)}` : "until revoked"]),
      ...revoked.map((e) => [e, "Access removed", e.args.grantee, ""]),
      ...viewed.map((e) => [e, "Opened", e.args.viewer, ""]),
    ].sort(([a], [b]) => a.blockNumber - b.blockNumber || a.index - b.index);
    const blockTimes = new Map();
    const timeOf = (e) => blockTimes.get(e.blockNumber) ?? blockTimes.set(e.blockNumber, e.getBlock().then((b) => b.timestamp)).get(e.blockNumber);
    const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [["Date and time (UTC)", "Event", "Record", "Person", "Wallet", "Note", "Transaction"]];
    for (const [e, what, who, note] of rows) {
      const when = new Date(Number(await timeOf(e)) * 1000).toISOString().replace("T", " ").slice(0, 19);
      lines.push([when, what, `#${e.args.recordId}`, nameOf(who) ?? "", who, note, txUrl(session, e.transactionHash) ?? e.transactionHash]);
    }
    downloadText("my-access-history.csv", lines.map((l) => l.map(cell).join(",")).join("\n"), "text/csv");
    return `Downloaded ${rows.length} ${rows.length === 1 ? "entry" : "entries"} of your access history.`;
  }

  return (
    <Card title="My health timeline" wide
      subtitle="All your records in date order, unlocked only in this browser. Download them any time: your health data is yours (India's DPDP Act 2023).">
      <div className="actions-inline">
        {!items && <ActionButton small action={show} busyLabel="Unlocking your records…">Show my timeline</ActionButton>}
        <ActionButton small tone="ghost" action={downloadRecords} busyLabel="Preparing…">Download my records (FHIR)</ActionButton>
        <ActionButton small tone="ghost" action={downloadHistory} busyLabel="Reading the access log…">Download my access history</ActionButton>
      </div>
      {items && (items.length === 0 ? <Empty>No records yet.</Empty> : (
        <ol className="timeline">
          {items.map((r) => (
            <li key={String(r.id)}>
              {r.error ? (
                <><span className="timeline-date">Record #{String(r.id)}</span><span className="muted small">Couldn't be unlocked in this browser: {r.error}</span></>
              ) : (
                <>
                  <span className="timeline-date">{r.admitted}{r.discharged && r.discharged !== r.admitted ? ` → ${r.discharged}` : ""}</span>
                  <div>
                    <b>{r.diagnosis}{r.icd ? ` (ICD-10 ${r.icd})` : ""}</b>
                    <div className="muted small">{[r.procedureName, r.hospital ?? nameOf(r.issuer)].filter(Boolean).join(" · ")}</div>
                    {r.medicines.length > 0 && <div className="small">Medicines: {r.medicines.join(", ")}</div>}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      ))}
    </Card>
  );
}

// Before treatment: "would this be covered?" Same rules the proof checks, run privately in this
// browser on the patient's own policy file. Nothing is sent anywhere.
function CoverageCheck() {
  const { session } = useApp();
  const inbox = useInbox();
  const mine = Object.values(inbox.policies).filter((p) => p.patient === lower(session));
  const [form, setForm] = useState({ policy: "", procedure: String(PROCEDURES[0].code), amount: "", date: todayInput() });
  const bind = binder(form, setForm);
  if (mine.length === 0) return null; // "My insurance" already says there's no policy yet
  const policy = mine.find((p) => String(p.commitment) === form.policy) ?? mine[0];
  const name = procedureName(form.procedure);
  const covered = policy.coveredProcedures.map(String).includes(form.procedure);
  const day = inputToSeconds(form.date);
  const inPeriod = day >= policy.policyStart && day < policy.policyExpiry;
  const paise = form.amount === "" || !Number.isFinite(Number(form.amount)) ? null : BigInt(Math.round(Number(form.amount) * 100));
  const checks = [
    { ok: covered, text: covered ? `${name} is covered by your ${policy.plan} plan` : `${name} isn't covered by your ${policy.plan} plan` },
    paise === null ? null : { ok: paise > 0n && paise <= policy.policyLimit, text: paise <= 0n ? "Enter a cost above zero"
      : paise <= policy.policyLimit ? `${rupees(paise)} is within your limit of ${rupees(policy.policyLimit)} per claim`
      : `${rupees(paise)} is above your limit of ${rupees(policy.policyLimit)} per claim` },
    { ok: inPeriod, text: inPeriod ? `${dateOf(day)} is inside your policy period` : `${dateOf(day)} is outside your policy period (${dateOf(policy.policyStart)} → ${dateOf(policy.policyExpiry)})` },
  ].filter(Boolean);
  const yes = checks.every((c) => c.ok);
  return (
    <Card title="Am I covered?" subtitle="Check before treatment. This runs only in your browser, with the same rules the claim proof uses." wide>
      <div className="form">
        <div className="row">
          {mine.length > 1 && <Field label="Policy"><select {...bind("policy")}>{mine.map((p) => <option key={String(p.commitment)} value={String(p.commitment)}>{p.plan} · {policyNumber(p)}</option>)}</select></Field>}
          <Field label="Procedure"><select {...bind("procedure")}>{PROCEDURES.map((p) => <option key={p.code} value={String(p.code)}>{p.name}</option>)}</select></Field>
          <Field label="Estimated cost (₹)" hint="Optional"><input type="number" min="0" {...bind("amount")} placeholder="e.g. 40000" /></Field>
          <Field label="Treatment date"><input type="date" {...bind("date")} /></Field>
        </div>
        <p className={`verdict ${yes ? "ok" : "bad"}`}>{yes ? <Check /> : <AlertCircle />}<b>{yes ? "Covered" : "Not covered"}</b></p>
        <ul className="checks">
          {checks.map((c) => <li key={c.text} className={c.ok ? "ok" : "bad"}>{c.ok ? <Check /> : <AlertCircle />}<span>{c.text}</span></li>)}
        </ul>
      </div>
    </Card>
  );
}

function ClaimHistory() {
  const { session } = useApp();
  const inbox = useInbox();
  const done = Object.values(inbox.claims).filter((c) => c.patient === lower(session) && c.status !== "awaiting-patient").sort((a, b) => Number(b.createdAt - a.createdAt));
  return (
    <Card title="My claim history" wide>
      {done.length === 0 ? <Empty>No claims yet.</Empty> : (
        <ul className="list">
          {done.map((c) => (
            <li key={c.id} className="stack">
              <div className="list-row">
                <div><b>{rupees(c.amount)}</b> · {procedureName(c.procedureCode)} · <Who address={c.hospital} />{c.reason && <div className="err small">{c.reason}</div>}</div>
                <div className="actions-inline">
                  <ClaimStatus status={c.status} />
                  {c.txHash && txUrl(session, c.txHash) && <a href={txUrl(session, c.txHash)} target="_blank" rel="noreferrer">tx ↗</a>}
                </div>
              </div>
              <ClaimSteps status={c.status} />
              {c.status === "paid" && (
                <Receipt no={c.billNo ? `Bill ${c.billNo}` : `Claim ${short(c.id)}`} paidOn={c.settledAt ? dateTimeOf(c.settledAt) : "—"}
                  policy={<code>{short(c.policyCommitment)}</code>} paidTo={<Who address={c.hospital} />} amount={rupees(c.amount)}
                  tx={c.txHash && txUrl(session, c.txHash) && <a href={txUrl(session, c.txHash)} target="_blank" rel="noreferrer">View transaction ↗</a>} />
              )}
              {c.status === "paid" && session.persona && (
                <ActionButton small tone="ghost" busyLabel="Submitting again…" action={async () => {
                  const [a, b, cc, pub] = c.calldata;
                  await send(session.insureTrust.submitClaim(a, b, cc, pub));
                  return "Paid again (this should never happen).";
                }}>Verify it can't be paid twice</ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
