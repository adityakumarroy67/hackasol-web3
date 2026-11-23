// Patient screen: health locker, records (open / share / revoke / history), policies, claim approval.
import { useState } from "react";
import { getAddress } from "ethers";
import * as R from "../../lib/records.js";
import { explainError, send, txUrl } from "./chain.js";
import { procedureName } from "./catalog.js";
import { ClaimStatus } from "./Hospital.jsx";
import { encryptionKeyOf, publishEncryptionKey, recordKeysFor } from "./keys.js";
import RecordView from "./RecordView.jsx";
import { downloadJson, nameOf, updateInbox, useInbox } from "./store.js";
import {
  ActionButton, Card, Empty, ErrorNote, Field, Loading, Pill, PrivacyPanel, Who,
  dateOf, dateTimeOf, nowSeconds, rupees, short, useApp, useLoad,
} from "./ui.jsx";

export default function Patient() {
  const { session } = useApp();
  if (!session.signer) return <p className="notice">Connect a wallet to use the patient screen.</p>;
  return (
    <div className="grid">
      <Locker />
      <ClaimApprovals />
      <Records />
      <Policies />
      <ClaimHistory />
    </div>
  );
}

const lower = (session) => session.address.toLowerCase();

function Locker() {
  const { session } = useApp();
  const inbox = useInbox();
  const me = lower(session);
  const onChain = useLoad(() => encryptionKeyOf(session, session.address), [session]);
  const [name, setName] = useState(nameOf(me) ?? "");
  const published = onChain.value != null;

  async function unlock() {
    if (!inbox.people[me]) {
      if (!name.trim()) throw new Error("Enter your name first.");
      updateInbox((d) => { d.people[me] = { name: name.trim(), role: "patient" }; });
    }
    await publishEncryptionKey(session); // one wallet signature (+ one transaction the first time)
    return "Locker unlocked. Your public key is on-chain, so hospitals can add records that only you can open.";
  }

  return (
    <Card title="Your health locker" subtitle="Records are encrypted for you. Your private key is re-created from your wallet when needed and never stored."
      badge={onChain.loading && onChain.value === undefined ? null : <Pill tone={published ? "ok" : "warn"}>{published ? "Unlocked ✓" : "Locked"}</Pill>}>
      {published ? (
        <p>Ready. Hospitals can add records to your locker, and you choose who else may read them.</p>
      ) : (
        <div className="form">
          {!inbox.people[me] && <Field label="Your name (shown to hospitals and the insurer in this demo)"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>}
          <ActionButton action={unlock} busyLabel="Unlocking (sign in your wallet)…">Unlock my locker</ActionButton>
        </div>
      )}
    </Card>
  );
}

function ClaimApprovals() {
  const { session } = useApp();
  const inbox = useInbox();
  const waiting = Object.values(inbox.claims).filter((c) => c.patient === lower(session) && c.status === "awaiting-patient");

  async function submit(claim) {
    try {
      const [a, b, c, pub] = claim.calldata;
      const receipt = await send(session.insureTrust.submitClaim(a, b, c, pub));
      updateInbox((d) => Object.assign(d.claims[claim.id], { status: "paid", txHash: receipt.hash, settledAt: nowSeconds() }));
      return { message: `Paid! ${rupees(claim.amount)} (test tINR) went straight to the hospital.`, tx: receipt.hash };
    } catch (e) {
      const reason = explainError(e);
      if (!/cancelled/i.test(reason)) updateInbox((d) => Object.assign(d.claims[claim.id], { status: "rejected", reason }));
      throw e;
    }
  }

  return (
    <Card title="Claims waiting for your approval" subtitle="A hospital prepared these. When you approve, the smart contract checks the proof and pays the hospital automatically."
      badge={waiting.length > 0 && <Pill tone="warn">{waiting.length} waiting</Pill>}>
      {waiting.length === 0 ? <Empty>Nothing waiting.</Empty> : (
        <ul className="list">
          {waiting.map((c) => (
            <li key={c.id} className="stack">
              <div className="list-row">
                <div><b>{rupees(c.amount)}</b> to <Who address={c.hospital} /><div className="muted small">{procedureName(c.procedureCode)} on {dateOf(c.claimDate)} · proof made in {(c.proofMs / 1000).toFixed(1)} s</div></div>
              </div>
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
  const me = session.address;
  const data = useLoad(async () => {
    const hr = session.healthRecords;
    const from = session.deployment.fromBlock;
    const ids = [...(await hr.recordsOf(me))].reverse();
    return Promise.all(ids.map(async (id) => {
      const [record, granted, revoked, viewed] = await Promise.all([
        hr.records(id),
        hr.queryFilter(hr.filters.AccessGranted(id), from),
        hr.queryFilter(hr.filters.AccessRevoked(id), from),
        hr.queryFilter(hr.filters.RecordViewed(id), from),
      ]);
      const others = [...new Set(granted.map((g) => g.args.grantee))].filter((a) => a.toLowerCase() !== me.toLowerCase());
      const access = await Promise.all(others.map(async (address) => ({
        address, active: await hr.hasAccess(id, address), expiresAt: granted.filter((g) => g.args.grantee === address).at(-1).args.expiresAt,
      })));
      const events = [
        ...granted.filter((g) => g.args.grantee.toLowerCase() !== me.toLowerCase()).map((e) => ({ e, text: "Access given to", who: e.args.grantee })),
        ...revoked.map((e) => ({ e, text: "Access removed for", who: e.args.grantee })),
        ...viewed.map((e) => ({ e, text: "Opened by", who: e.args.viewer })),
      ].sort((a, b) => a.e.blockNumber - b.e.blockNumber || a.e.index - b.e.index);
      const history = await Promise.all(events.map(async (h) => ({ ...h, time: (await h.e.getBlock()).timestamp })));
      return { id, record, access, history };
    }));
  }, [session]);
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
      {data.loading && !data.value ? <Loading /> : data.error ? <ErrorNote>{data.error}</ErrorNote> : data.value.length === 0 ? (
        <Empty>No records yet. A hospital adds them after a visit (Hospital tab → Write a medical record).</Empty>
      ) : (
        <ul className="list">
          {data.value.map(({ id, record, access, history }) => (
            <li key={String(id)} className="stack">
              <div className="list-row">
                <div>
                  <b>Record #{String(id)}</b> from <Who address={record.issuer} /> · {dateOf(record.createdAt)}
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
  const people = Object.entries(inbox.people).filter(([a, p]) => a !== me && p.role !== "insurer");
  const [to, setTo] = useState(people.find(([, p]) => p.role === "doctor")?.[0] ?? people[0]?.[0] ?? "");
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
      <Field label="Share with" hint={nameOf(to) ? `= ${nameOf(to)}` : "Pick from the list or paste a wallet address"}>
        <input list={`people-${id}`} value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x… wallet address" />
        <datalist id={`people-${id}`}>{people.map(([a, p]) => <option key={a} value={a}>{p.name} ({p.role})</option>)}</datalist>
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
  const hospitals = Object.entries(inbox.hospitalKeys);
  const holders = useLoad(async () => Object.fromEntries(await Promise.all(mine.map(async (p) => [String(p.commitment), await session.insureTrust.policyHolder(p.commitment)]))), [session, mine.length]);
  const [pick, setPick] = useState({});

  return (
    <Card title="My insurance" subtitle="Your policy files (from the insurer). Share one with a hospital so it can prepare claims for you.">
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
                  <div><b>{p.plan}</b> · limit {rupees(p.policyLimit)} per claim<div className="muted small">{dateOf(p.policyStart)} → {dateOf(p.policyExpiry)} · covers {p.coveredProcedures.map(procedureName).join(", ")}</div></div>
                  <Pill tone={revoked ? "bad" : expired ? "warn" : "ok"}>{revoked ? "Revoked" : expired ? "Expired" : "Active"}</Pill>
                </div>
                {sharedWith.length > 0 && <div className="muted small">Shared with: {sharedWith.map((h) => nameOf(h) ?? short(h)).join(", ")}</div>}
                <div className="actions-inline">
                  {hospitals.length === 0 ? <span className="muted small">No hospitals registered yet.</span> : (
                    <>
                      <select value={hospital} onChange={(e) => setPick({ ...pick, [key]: e.target.value })}>{hospitals.map(([a, h]) => <option key={a} value={a}>{h.name}</option>)}</select>
                      <ActionButton small action={async () => {
                        updateInbox((d) => { const list = (d.policyShares[key] ??= []); if (!list.includes(hospital)) list.push(hospital); });
                        return `Policy file handed to ${nameOf(hospital) ?? short(hospital)} (simulated). They can now prepare claims for you.`;
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
    <Card title="My claim history">
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
              {c.status === "paid" && (
                <ActionButton small tone="ghost" busyLabel="Submitting again…" action={async () => {
                  const [a, b, cc, pub] = c.calldata;
                  await send(session.insureTrust.submitClaim(a, b, cc, pub));
                  return "Paid again (this should never happen).";
                }}>Try to submit again (double-payment test)</ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
