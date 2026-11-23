// Patient screen: health locker, records (open / share / revoke / history), policies, claim approval.
import { useState } from "react";
import { getAddress } from "ethers";
import { FolderLock, ReceiptText, ShieldCheck, UserRound } from "lucide-react";
import * as R from "../../lib/records.js";
import { eventsOf, explainError, revertName, send, txUrl } from "./chain.js";
import { BLOOD_GROUPS, policyNumber, procedureName } from "./catalog.js";
import { ClaimStatus } from "./Hospital.jsx";
import { encryptionKeyOf, publishEncryptionKey, recordKeysFor } from "./keys.js";
import RecordView from "./RecordView.jsx";
import { approvedList, downloadJson, nameOf, rootOf, updateInbox, useInbox } from "./store.js";
import {
  ActionButton, Card, ClaimSteps, EditButton, Empty, ErrorNote, Field, Loading, Pill, PrivacyPanel, Receipt, Summary, Who, binder,
  dateOf, dateTimeOf, nowSeconds, rupees, short, useApp, useLoad,
} from "./ui.jsx";

// Sidebar sections. Claims waiting for approval are counted, and open first.
export function usePatientSections() {
  const { session } = useApp();
  const inbox = useInbox();
  const me = lower(session);
  const key = useLoad(() => encryptionKeyOf(session, session.address), [session]);
  const profile = { id: "profile", label: "My details", icon: UserRound };
  // Registered = encryption key on-chain (works in any browser), or just created here.
  if (!key.value && !inbox.people[me]?.profile) return { sections: [profile], initial: "profile" };
  const waiting = Object.values(inbox.claims).filter((c) => c.patient === me && c.status === "awaiting-patient").length;
  return {
    sections: [
      { id: "records", label: "Records", icon: FolderLock },
      { id: "insurance", label: "Insurance", icon: ShieldCheck },
      { id: "claims", label: "Claims", icon: ReceiptText, count: waiting },
      profile,
    ],
    initial: waiting ? "claims" : "records",
  };
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
      {section === "records" && <Records />}
      {section === "insurance" && <Policies />}
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
