// App shell: sign in by role, then that person's Home (to-dos + tiles) and the pages it opens.
import { useEffect, useReducer, useState } from "react";
import { ArrowLeft, ChevronRight, Hospital as HospitalIcon, ShieldCheck, Stethoscope, User } from "lucide-react";
import {
  LOCAL, SEPOLIA, TEST_ACCOUNTS, addressUrl, connectGuest, connectMetaMask, connectTestAccount, explainError,
  isDeployed, localChainAvailable, switchMetaMaskTo, testAccountAddress,
} from "./chain.js";
import Doctor, { DoctorHome } from "./Doctor.jsx";
import Hospital, { HospitalHome } from "./Hospital.jsx";
import Insurer, { InsurerHome } from "./Insurer.jsx";
import Patient, { PatientHome } from "./Patient.jsx";
import { inboxNow, nameOf, openInbox, openStorage, resetInbox, updateInbox, useInbox } from "./store.js";
import { AppContext, ErrorNote, Pill, Receipt, Toasts, short, useApp } from "./ui.jsx";

const ROLES = {
  patient: { label: "Patient", icon: User, short: "Records, insurance, claim approvals", text: "Keep your medical records private, choose who can read them, and approve insurance claims." },
  hospital: { label: "Hospital", icon: HospitalIcon, short: "Write records, send claims", text: "Write encrypted medical records and send insurance claims backed by a zero-knowledge proof." },
  doctor: { label: "Doctor", icon: Stethoscope, short: "Read records patients share", text: "Read records that patients share with you, for as long as they allow." },
  insurer: { label: "Insurer", icon: ShieldCheck, short: "Hospitals, policies, payouts", text: "Approve hospitals, issue policies and pay verified claims." },
  guest: { label: "Public claims", icon: ShieldCheck, text: "Every settled claim, live from the blockchain. Read-only, no wallet needed." },
};
// Page titles, per role (pages are opened from Home).
const PAGES = {
  patient: { records: "Records", insurance: "Insurance", claims: "Claims", profile: "My details" },
  hospital: { records: "Records", claims: "Claims", profile: "Hospital details" },
  doctor: { profile: "My details" },
  insurer: { claims: "Paid claims", hospitals: "Hospitals", policies: "Policies", pool: "Money pool" },
  guest: { claims: "Paid claims" },
};

export default function App() {
  const [session, setSession] = useState(null);
  const [mode, setMode] = useState(null); // "test" | "metamask" | "guest"
  const [storage, setStorage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, refresh] = useReducer((x) => x + 1, 0);
  const [toasts, setToasts] = useState([]);
  const inbox = useInbox();
  const dismiss = (id) => setToasts((ts) => ts.filter((t) => t.id !== id));
  const notify = (toast) => {
    const id = crypto.randomUUID();
    setToasts((ts) => [...ts.slice(-2), { ...toast, id }]); // at most three on screen
    setTimeout(() => dismiss(id), 6000);
  };

  useEffect(() => { openStorage().then(setStorage); }, []);
  useEffect(() => setToasts([]), [session?.address, session?.chainId]); // a new person starts with no old toasts

  // wantRole: the role chosen on the login page (MetaMask only; demo people already have one).
  async function start(nextMode, connect, wantRole) {
    setBusy(true);
    setError(null);
    try {
      const s = await connect();
      openInbox(s);
      updateInbox((d) => {
        d.people[s.deployment.insurer.toLowerCase()] ??= { name: "InsureTrust Insurance", role: "insurer" };
        if (s.chainId === LOCAL) for (const a of TEST_ACCOUNTS) d.people[testAccountAddress(a.index).toLowerCase()] ??= { name: a.name, role: a.role };
      });
      if (wantRole) claimRole(s, wantRole);
      setSession(s);
      setMode(nextMode);
      refresh();
    } catch (e) {
      console.error(e);
      setError(explainError(e));
      // e.g. MetaMask on an unsupported network or the wrong account: stay on the login page, which says why.
      if (nextMode === "metamask") setSession(null);
    }
    setBusy(false);
  }
  const startTest = (index) => start("test", () => connectTestAccount(index));
  const startMetaMask = (wantRole) => start("metamask", connectMetaMask, wantRole);

  // Follow MetaMask account / network switches. Newer MetaMask versions don't always send the
  // "accountsChanged" event, so the site also checks the active account every 1.5 seconds.
  useEffect(() => {
    if (mode !== "metamask" || !window.ethereum || !session) return; // signed out: wait for a click
    const check = async () => {
      try {
        const [account] = await window.ethereum.request({ method: "eth_accounts" });
        const chainId = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
        if ((account && account.toLowerCase() !== session?.address?.toLowerCase()) || chainId !== session?.chainId) startMetaMask();
      } catch {}
    };
    const timer = setInterval(check, 1500);
    window.ethereum.on?.("accountsChanged", check);
    window.ethereum.on?.("chainChanged", check);
    return () => {
      clearInterval(timer);
      window.ethereum.removeListener?.("accountsChanged", check);
      window.ethereum.removeListener?.("chainChanged", check);
    };
  }, [mode, session?.address, session?.chainId]);

  // Opens MetaMask's account picker (lets this site use another of your accounts).
  async function switchAccount() {
    try {
      await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      startMetaMask();
    } catch (e) { setError(explainError(e)); }
  }
  const signOut = () => { setSession(null); setMode(null); setError(null); };

  if (!storage) return null;
  const role = session && roleOf(session, inbox);
  return (
    <AppContext.Provider value={{ session, storage, refresh, refreshKey, notify }}>
      <Toasts toasts={toasts} dismiss={dismiss} />
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="brand"><span className="logo"><ShieldCheck /></span> InsureTrust <small>private health insurance claims</small></div>
        {session && (
          <div className="status">
            <Pill>{session.network.name}</Pill>
            {session.address ? (
              <span className="who"><b>{nameOf(session.address) ?? "My wallet"}</b>{role && ROLES[role] && <span className="muted"> · {ROLES[role].label}</span>} <code>{short(session.address)}</code></span>
            ) : <Pill>Guest (read-only)</Pill>}
            {mode === "metamask" && <button className="btn ghost small" onClick={switchAccount}>Switch account</button>}
            <button className="btn ghost small" onClick={signOut}>Sign out</button>
          </div>
        )}
      </header>

      {!session ? (
        <Welcome busy={busy} error={error} onTest={startTest} onMetaMask={startMetaMask} onGuest={() => start("guest", connectGuest)}
          onSwitch={async (chainId, wantRole) => {
            try {
              if (!window.ethereum) throw new Error("MetaMask isn't installed. Get it free at metamask.io, then reload this page.");
              await switchMetaMaskTo(chainId);
              startMetaMask(wantRole);
            } catch (e) { setError(explainError(e)); }
          }} />
      ) : (
        <>
          <main id="main" key={`${session.chainId}-${session.address}`}><RoleScreen /></main>
          <Footer session={session} mode={mode} storage={storage} />
        </>
      )}
    </AppContext.Provider>
  );
}

const roleOf = (session, inbox) => (!session.signer ? "guest" : session.isInsurer ? "insurer" : inbox.people[session.address.toLowerCase()]?.role);

// A MetaMask account signs in as the role picked on the login page, if that fits the account.
function claimRole(session, wantRole) {
  const me = session.address.toLowerCase();
  if (wantRole === "insurer") {
    if (!session.isInsurer) throw new Error(`Only the insurer's account (${short(session.deployment.insurer)}) can sign in as the insurer. Switch account in MetaMask.`);
    return;
  }
  if (session.isInsurer) throw new Error("This MetaMask account is the insurer's. To sign in as a patient, hospital or doctor, switch to another account in MetaMask.");
  const current = inboxNow().people[me]?.role;
  if (current && current !== wantRole) throw new Error(`This account is registered as a ${current}. Sign in as ${ROLES[current]?.label ?? current}, or switch account in MetaMask.`);
  if (!current) updateInbox((d) => { d.people[me] = { ...(d.people[me] ?? {}), role: wantRole }; });
}

// The signed-in person's Home, or the page it opened. Asks for a role only if the account has none
// (e.g. it reconnected after a MetaMask account switch).
function RoleScreen() {
  const { session } = useApp();
  const inbox = useInbox();
  const role = roleOf(session, inbox);
  if (!role) {
    const me = session.address.toLowerCase();
    return (
      <section className="role-picker">
        <h2>How will you use InsureTrust?</h2>
        <p className="muted">Choose once for this account</p>
        <div className="role-cards">
          {["patient", "hospital", "doctor"].map((r) => { const Icon = ROLES[r].icon; return (
            <button key={r} className="role-card" onClick={() => updateInbox((d) => { d.people[me] = { ...(d.people[me] ?? {}), role: r }; })}>
              <span className="role-icon"><Icon /></span>
              <b>I'm a {ROLES[r].label.toLowerCase()}</b>
              <span className="muted">{ROLES[r].text}</span>
            </button>
          ); })}
        </div>
      </section>
    );
  }
  const [Home, Page] = {
    patient: [PatientHome, Patient], hospital: [HospitalHome, Hospital], doctor: [DoctorHome, Doctor],
    insurer: [InsurerHome, Insurer], guest: [InsurerHome, Insurer],
  }[role];
  return <RoleApp key={role} role={role} Home={Home} Page={Page} />;
}

function RoleApp({ role, Home, Page }) {
  const [page, setPage] = useState(null); // null = Home
  const go = (p) => { setPage(p); scrollTo({ top: 0 }); };
  return (
    <>
      {page && <button className="back" data-nav="Home" onClick={() => go(null)}><ArrowLeft /> Home</button>}
      <PageTitle role={role} page={page} />
      <div key={page ?? "home"} className="section-body">{page ? <Page section={page} /> : <Home go={go} />}</div>
    </>
  );
}

function PageTitle({ role, page }) {
  const { session } = useApp();
  const name = session.address && nameOf(session.address);
  if (page) {
    return <div className="page-title"><h2>{PAGES[role][page] ?? page}</h2><p className="muted">{name ? `${name} · ` : ""}{ROLES[role].label}</p></div>;
  }
  return (
    <div className="page-title">
      <h2>{name ?? ROLES[role].label}</h2>
      <p className="muted">{name ? `${ROLES[role].label} · ` : ""}{ROLES[role].text}</p>
    </div>
  );
}

function Welcome({ busy, error, onTest, onMetaMask, onGuest, onSwitch }) {
  return (
    <main id="main" className="welcome">
      <section className="hero">
        <h1>Insurance claims that prove themselves, without revealing your diagnosis</h1>
        <p>
          A hospital proves a claim follows your policy with a <b>zero-knowledge proof</b>. A smart contract checks the proof
          and pays automatically. The insurer never sees your medical details, and <b>you</b> decide who can read your records.
        </p>
        <ol className="steps">
          <li><b>Insurer</b> approves hospitals and issues a policy. Only fingerprints go on the blockchain.</li>
          <li><b>Hospital</b> writes an encrypted record and turns a claim into a proof, right in the browser.</li>
          <li><b>Patient</b> approves. The contract verifies the proof, blocks double payment, and pays the hospital.</li>
        </ol>
      </section>
      <Login busy={busy} error={error} onTest={onTest} onMetaMask={onMetaMask} onGuest={onGuest} onSwitch={onSwitch} />
      <Receipt example no="Claim no. 0003" paidOn="21 Nov 2026, 4:12 pm" policy={<code>0x1f3a…9c2e</code>}
        paidTo="Sanjeevani Multispeciality" amount="₹42,000" />
    </main>
  );
}

// Step 1: choose a role. Step 2: choose who (a demo person, or your MetaMask account).
function Login({ busy, error, onTest, onMetaMask, onGuest, onSwitch }) {
  const [role, setRole] = useState(null);
  const status = <>{busy && <p className="muted"><span className="spinner" /> Signing in…</p>}{error && <ErrorNote>{error}</ErrorNote>}</>;
  if (!role) {
    return (
      <section className="card connect">
        <h3>Sign in as</h3>
        <div className="role-grid">
          {["patient", "hospital", "doctor", "insurer"].map((r) => { const Icon = ROLES[r].icon; return (
            <button key={r} className="role-card" onClick={() => setRole(r)}>
              <span className="role-icon"><Icon /></span>
              <b>{ROLES[r].label}</b>
              <span className="muted">{ROLES[r].short}</span>
            </button>
          ); })}
        </div>
        {isDeployed(SEPOLIA) && (
          <button className="btn ghost" disabled={busy} onClick={onGuest}>Just looking? View public claims as a guest</button>
        )}
        {status}
      </section>
    );
  }
  const people = TEST_ACCOUNTS.filter((a) => a.role === role);
  return (
    <section className="card connect">
      <button className="back" onClick={() => setRole(null)}><ArrowLeft /> All roles</button>
      <h3>Sign in as {ROLES[role].label.toLowerCase()}</h3>
      {localChainAvailable && (
        <div className="option">
          <h4>Demo people <Pill tone="ok">no wallet needed</Pill></h4>
          <div className="people">
            {people.map((a) => (
              <button key={a.index} className="person" disabled={busy} onClick={() => onTest(a.index)}>
                <span>{a.name}</span><code>{short(testAccountAddress(a.index))}</code><ChevronRight />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="option">
        <h4>MetaMask</h4>
        <p className="muted">
          {role === "insurer" ? "Use the insurer's account (the one that deployed the contracts)."
            : `Use your own ${role}'s account${isDeployed(SEPOLIA) ? " on the Sepolia test network" : ""}. Each role needs its own MetaMask account.`}
        </p>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => onMetaMask(role)}>Connect MetaMask</button>
          {isDeployed(SEPOLIA) && <button className="btn ghost" disabled={busy} onClick={() => onSwitch(SEPOLIA, role)}>Switch MetaMask to Sepolia</button>}
          {localChainAvailable && <button className="btn ghost" disabled={busy} onClick={() => onSwitch(LOCAL, role)}>Add local chain to MetaMask</button>}
        </div>
      </div>
      {status}
    </section>
  );
}

function Footer({ session, mode, storage }) {
  const d = session.deployment;
  const link = (label, address) => {
    const url = addressUrl(session, address);
    return url ? <a href={url} target="_blank" rel="noreferrer">{label} ↗</a> : <span title={address}>{label} <code>{short(address)}</code></span>;
  };
  return (
    <footer>
      <div>Contracts on {session.network.name}: {link("InsureTrust", d.insureTrust)} · {link("HealthRecords", d.healthRecords)} · {link("ClaimVerifier", d.verifier)} · {link("tINR", d.token)} · Encrypted files: {storage.label}</div>
      <div className="muted">Test network with fictional data and test money (tINR has no value). Never enter real medical data. · Hack-a-Sol 5.0 · W3-01
        {mode === "test" && <> · <button className="linklike" onClick={() => { resetInbox(); location.reload(); }}>clear this browser's demo data</button></>}
      </div>
    </footer>
  );
}
