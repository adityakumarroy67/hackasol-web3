// Doctor screen: one-step registration (details + encryption key), then records patients shared.
import { useState } from "react";
import * as R from "../../lib/records.js";
import { eventsOf, send } from "./chain.js";
import { encryptionKeyOf, publishEncryptionKey, recordKeysFor } from "./keys.js";
import RecordView from "./RecordView.jsx";
import { updateInbox, useInbox } from "./store.js";
import { ActionButton, Card, EditButton, Empty, ErrorNote, Field, Loading, Pill, Summary, Who, binder, dateOf, useApp, useLoad } from "./ui.jsx";

export default function Doctor() {
  const { session } = useApp();
  const inbox = useInbox();
  const key = useLoad(() => encryptionKeyOf(session, session.address), [session]);
  if (key.value === undefined) return key.error ? <ErrorNote>{key.error}</ErrorNote> : <Loading />;
  const registered = key.value !== null && inbox.people[session.address.toLowerCase()]?.details;
  if (!registered) return <div className="grid"><Profile registered={false} keyPublished={key.value !== null} /></div>;
  return (
    <div className="grid">
      <SharedWithMe />
      <Profile registered keyPublished />
    </div>
  );
}

const SAMPLE_DOCTOR = { specialty: "General surgery", regNo: "CGMC-2016-03321" };

function Profile({ registered, keyPublished }) {
  const { session } = useApp();
  const inbox = useInbox();
  const me = session.address.toLowerCase();
  const person = inbox.people[me];
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    name: person?.name ?? "", ...(session.persona ? SAMPLE_DOCTOR : { specialty: "", regNo: "" }), ...(person?.details ?? {}),
  }));
  const bind = binder(form, setForm);

  async function save() {
    if (!form.name.trim()) throw new Error("Enter your name.");
    if (!form.regNo.trim()) throw new Error("Enter your medical council registration number.");
    // The public encryption key is the "padlock" patients use to share records with you.
    if (!keyPublished) await publishEncryptionKey(session);
    updateInbox((d) => { d.people[me] = { ...(d.people[me] ?? {}), name: form.name.trim(), role: "doctor", details: { specialty: form.specialty.trim(), regNo: form.regNo.trim() } }; });
    setEditing(false);
    return registered ? "Details saved." : "Registered. Patients can now share records with you.";
  }

  if (registered && !editing) {
    return (
      <Card title="Your details" badge={<EditButton onClick={() => setEditing(true)} />}>
        <Summary rows={[["Name", person.name], ["Specialty", person.details.specialty], ["Registration no.", person.details.regNo]]} />
      </Card>
    );
  }
  return (
    <Card title={registered ? "Edit your details" : "Register as a doctor"}
      subtitle={registered ? null : "Patients find you by name and specialty. Your wallet signs once and sends one transaction so records can be shared with you securely."}>
      <div className="form">
        <Field label="Full name"><input {...bind("name")} placeholder="Dr. …" /></Field>
        <div className="row">
          <Field label="Specialty"><input {...bind("specialty")} placeholder="e.g. Cardiology" /></Field>
          <Field label="Medical council registration no."><input {...bind("regNo")} /></Field>
        </div>
        <div className="actions-inline">
          <ActionButton action={save} busyLabel={registered ? "Saving…" : "Registering (confirm in your wallet)…"}>{registered ? "Save" : "Register as doctor"}</ActionButton>
          {registered && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
      </div>
    </Card>
  );
}

function SharedWithMe() {
  const { session, storage } = useApp();
  const me = session.address;
  const data = useLoad(async () => {
    const hr = session.healthRecords;
    const grants = await eventsOf(session, hr, hr.filters.AccessGranted(null, me));
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
    return { message: "Opened. This view is recorded in the patient's access history.", tx: receipt.hash };
  }

  return (
    <Card title="Records shared with me" subtitle="Patients give you time-limited access and can take it back at any time" wide>
      {data.loading && !data.value ? <Loading /> : data.error ? <ErrorNote>{data.error}</ErrorNote> : data.value.length === 0 ? (
        <Empty>No records shared with you yet. Patients can share a record from their dashboard.</Empty>
      ) : (
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
