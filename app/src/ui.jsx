// Shared screen pieces: app context, data loading, buttons, cards, formatting.
import { Fragment, createContext, useContext, useEffect, useState } from "react";
import { AlertCircle, BadgeCheck, Check, ChevronRight, Eye, Lock, ShieldCheck, X } from "lucide-react";
import { explainError, txUrl } from "./chain.js";
import { nameOf, useInbox } from "./store.js";

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// Load data from the blockchain; reloads after every action (refreshKey) or when deps change.
export function useLoad(loader, deps = []) {
  const { refreshKey } = useApp();
  const [state, setState] = useState({ loading: true, value: undefined, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader().then(
      (value) => alive && setState({ loading: false, value, error: null }),
      (e) => { console.error(e); if (alive) setState({ loading: false, value: undefined, error: explainError(e) }); },
    );
    return () => { alive = false; };
  }, [...deps, refreshKey]);
  return state;
}

// ---------- formatting ----------
export const rupees = (paise) => "₹" + (Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const short = (x) => { const s = typeof x === "bigint" ? "0x" + x.toString(16) : String(x ?? ""); return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s; };
export const dateOf = (seconds) => new Date(Number(seconds) * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const dateTimeOf = (seconds) => new Date(Number(seconds) * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
export const todayInput = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
export const inputToSeconds = (yyyyMmDd) => BigInt(Date.parse(yyyyMmDd + "T00:00:00Z") / 1000); // midnight UTC
export const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));

// ---------- components ----------
export function Card({ title, subtitle, badge, children, wide }) {
  return (
    <section className={`card${wide ? " wide" : ""}`}>
      <header className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {badge}
      </header>
      {children}
    </section>
  );
}

export const Pill = ({ tone = "info", children }) => <span className={`pill ${tone}`}>{children}</span>;

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

// A button that runs an async action, shows progress, then a success or plain-language error.
// The action may return a success message (string) or { message, tx } to show a transaction link.
export function ActionButton({ action, children, busyLabel = "Working…", disabled, tone = "primary", small }) {
  const { refresh, session, notify } = useApp();
  const [state, setState] = useState({ busy: false, ok: null, error: null, tx: null });
  async function run() {
    setState({ busy: true, ok: null, error: null, tx: null });
    try {
      const result = await action();
      const message = typeof result === "string" ? result : result?.message ?? null;
      setState({ busy: false, ok: message, error: null, tx: result?.tx ?? null });
      if (result?.tx) notify?.({ message, tx: result.tx }); // a confirmed transaction also gets a toast
    } catch (e) {
      console.error(e);
      setState({ busy: false, ok: null, error: explainError(e), tx: null });
    }
    refresh();
  }
  const link = state.tx && txUrl(session, state.tx);
  return (
    <div className="action">
      <button className={`btn ${tone}${small ? " small" : ""}`} onClick={run} disabled={disabled || state.busy}>
        {state.busy ? <><span className="spinner" /> {busyLabel}</> : children}
      </button>
      {state.ok && <p className="ok"><Check /><span>{state.ok} {link && <a href={link} target="_blank" rel="noreferrer">View transaction ↗</a>}</span></p>}
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </div>
  );
}

// Show a name (if known) plus a short address.
export function Who({ address }) {
  const { people } = useInbox();
  if (!address) return <span className="muted">—</span>;
  const name = nameOf(address, people);
  return <span className="who" title={address}>{name ? <b>{name}</b> : null} <code>{short(address)}</code></span>;
}

// Placeholder lines while blockchain data loads (screen readers hear "Loading").
export const Loading = ({ what = "Loading" }) => (
  <div className="skeleton" role="status" aria-label={what}><span /><span /><span /></div>
);

// One headline number with its label. With onClick it is a tile that opens that page
// (nav names the page for tests when it differs from the label).
export function Kpi({ icon: Icon, label, value, note, onClick, nav = label }) {
  const body = <><span className="kpi-label"><Icon />{label}</span><b>{value}</b>{note && <small>{note}</small>}</>;
  if (!onClick) return <div className="kpi">{body}</div>;
  return <button className="kpi tile" data-nav={nav} onClick={onClick}>{body}<ChevronRight className="tile-go" /></button>;
}

// The person's next actions, each opening the page where it's done.
// items: [{ text, detail, onClick }]
export function Todo({ items }) {
  return (
    <Card title="To do" wide>
      {items.length === 0 ? <Empty><Check /> Nothing needs you right now.</Empty> : (
        <ul className="todo">
          {items.map((i) => (
            <li key={i.text}>
              <button onClick={i.onClick}><span><b>{i.text}</b>{i.detail && <small>{i.detail}</small>}</span><ChevronRight /></button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Where a claim is in its journey: proof made → patient approves → contract verifies and pays.
export function ClaimSteps({ status }) {
  const steps = [
    ["Proof created", "done"],
    ["Patient approval", status === "awaiting-patient" ? "current" : status === "declined" ? "failed" : "done"],
    ["Verified & paid", status === "paid" ? "done" : status === "rejected" ? "failed" : "todo"],
  ];
  return (
    <ol className="claim-steps" aria-label="Claim progress">
      {steps.map(([label, state]) => (
        <li key={label} className={state}>
          <span className="dot">{state === "done" ? <Check /> : state === "failed" ? <X /> : null}</span>{label}
        </li>
      ))}
    </ol>
  );
}

// Confirmed transactions, bottom right; each closes by itself after a few seconds.
export function Toasts({ toasts, dismiss }) {
  const { session } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const link = session && txUrl(session, t.tx);
        return (
          <div key={t.id} className="toast">
            <Check />
            <div><p><b>Transaction confirmed</b></p>{t.message && <small>{t.message}</small>}
              {link && <p><a href={link} target="_blank" rel="noreferrer">View on the explorer ↗</a></p>}</div>
            <button onClick={() => dismiss(t.id)} aria-label="Close"><X /></button>
          </div>
        );
      })}
    </div>
  );
}
export const Empty = ({ children }) => <p className="empty">{children}</p>;
export const ErrorNote = ({ children }) => <p className="err"><AlertCircle /><span>{children}</span></p>;

// "What's public vs what stays private" panel.
export function PrivacyPanel({ publicItems, privateItems }) {
  return (
    <div className="privacy">
      <div>
        <h4><Eye /> Public (on the blockchain)</h4>
        <ul>{publicItems.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <div>
        <h4><Lock /> Stays private</h4>
        <ul>{privateItems.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
    </div>
  );
}

// Form helpers: bind("field") gives an input its value + onChange; seconds -> "YYYY-MM-DD".
export const binder = (form, setForm) => (key) => ({ value: form[key] ?? "", onChange: (e) => setForm({ ...form, [key]: e.target.value }) });
export const secondsToInput = (seconds) => new Date(Number(seconds) * 1000).toISOString().slice(0, 10);

// Read-only list of label/value pairs (empty values are skipped).
export const Summary = ({ rows }) => (
  <dl className="record">{rows.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
);
export const EditButton = ({ onClick }) => <button className="btn ghost small" onClick={onClick}>Edit</button>;

// Signature detail: marks only things that are actually verified on the blockchain.
export const Seal = ({ children }) => <span className="seal"><BadgeCheck />{children}</span>;

// The one rich moment: a paid claim shown as a stamped receipt. Lists only what is public.
export function Receipt({ no, paidOn, policy, paidTo, amount, tx, example }) {
  return (
    <figure className="receipt">
      {example && <figcaption>Example settlement</figcaption>}
      <header><span><ShieldCheck /> InsureTrust</span><span>{no}</span></header>
      <dl>
        <dt>Paid on</dt><dd>{paidOn}</dd>
        <dt>Policy</dt><dd>{policy}</dd>
        <dt>Paid to</dt><dd>{paidTo}</dd>
      </dl>
      <div className="receipt-total"><span>Amount paid</span><b>{amount}</b></div>
      <p className="receipt-note">Not on this receipt: diagnosis, procedure, treatment date</p>
      {tx && <p className="receipt-tx">{tx}</p>}
      <div className="stamp" aria-label="Proof verified on-chain"><BadgeCheck /><span>Proof<br />verified</span><small>on-chain</small></div>
    </figure>
  );
}
