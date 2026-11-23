// Shared screen pieces: app context, data loading, buttons, cards, formatting.
import { Fragment, createContext, useContext, useEffect, useState } from "react";
import { AlertCircle, BadgeCheck, Check, Eye, Lock, ShieldCheck } from "lucide-react";
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
  const { refresh, session } = useApp();
  const [state, setState] = useState({ busy: false, ok: null, error: null, tx: null });
  async function run() {
    setState({ busy: true, ok: null, error: null, tx: null });
    try {
      const result = await action();
      const message = typeof result === "string" ? result : result?.message ?? null;
      setState({ busy: false, ok: message, error: null, tx: result?.tx ?? null });
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

export const Loading = ({ what = "Loading" }) => <p className="muted"><span className="spinner" /> {what}…</p>;
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
