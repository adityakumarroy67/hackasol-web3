// App shell: welcome / connect, header, and ONE screen for the signed-in person's role.
import { useEffect, useReducer, useState } from "react";
import { Hospital as HospitalIcon, ShieldCheck, Stethoscope, User } from "lucide-react";
import {
  LOCAL, SEPOLIA, TEST_ACCOUNTS, addressUrl, connectGuest, connectMetaMask, connectTestAccount, explainError,
  isDeployed, localChainAvailable, switchMetaMaskTo, testAccountAddress,
} from "./chain.js";
import Doctor from "./Doctor.jsx";
import Hospital from "./Hospital.jsx";
import Insurer from "./Insurer.jsx";
import Patient from "./Patient.jsx";
import { nameOf, openInbox, openStorage, resetInbox, updateInbox, useInbox } from "./store.js";
import { AppContext, ErrorNote, Pill, Receipt, short, useApp } from "./ui.jsx";

const ROLES = {
  patient: { label: "Patient", icon: User, text: "Keep your medical records private, choose who can read them, and approve insurance claims." },
  hospital: { label: "Hospital", icon: HospitalIcon, text: "Write encrypted medical records and send insurance claims backed by a zero-knowledge proof." },
  doctor: { label: "Doctor", icon: Stethoscope, text: "Read records that patients share with you, for as long as they allow." },
  insurer: { label: "Insurer", icon: ShieldCheck, text: "Approve hospitals, issue policies and pay verified claims." },
  guest: { label: "Public claims", icon: ShieldCheck, text: "Every settled claim, live from the blockchain. Read-only, no wallet needed." },
};

export default function App() {
  const [session, setSession] = useState(null);
  const [mode, setMode] = useState(null); // "test" | "metamask" | "guest"
  const [testIndex, setTestIndex] = useState(1);
  const [storage, setStorage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, refresh] = useReducer((x) => x + 1, 0);

  useEffect(() => { openStorage().then(setStorage); }, []);

  async function start(nextMode, connect) {
    setBusy(true);
    setError(null);
    try {
      const s = await connect();
      openInbox(s);
      updateInbox((d) => {
        d.people[s.deployment.insurer.toLowerCase()] ??= { name: "InsureTrust Insurance", role: "insurer" };
        if (s.chainId === LOCAL) for (const a of TEST_ACCOUNTS) d.people[testAccountAddress(a.index).toLowerCase()] ??= { name: a.name, role: a.role };
      });
      setSession(s);
      setMode(nextMode);
      refresh();
    } catch (e) {
      console.error(e);
      setError(explainError(e));
      // A MetaMask switch to an unsupported network: sign out so the welcome screen shows why,
      // with its network buttons (the old session would only fail every transaction).
      if (nextMode === "metamask") setSession(null);
    }
    setBusy(false);
  }
  const startTest = (index) => { setTestIndex(index); start("test", () => connectTestAccount(index)); };
  const startMetaMask = () => start("metamask", connectMetaMask);

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

  if (!storage) return null;
  return (
    <AppContext.Provider value={{ session, storage, refresh, refreshKey }}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="brand"><span className="logo"><ShieldCheck /></span> InsureTrust <small>private health insurance claims</small></div>
        {session && (
          <div className="status">
            <Pill>{session.network.name}</Pill>
            {mode === "test" ? (
              <select value={testIndex} onChange={(e) => startTest(Number(e.target.value))} aria-label="Test account">
                {TEST_ACCOUNTS.map((a) => <option key={a.index} value={a.index}>{a.name} · {ROLES[a.role].label}</option>)}
              </select>
            ) : session.address ? (
              <>
                <span className="who"><b>{nameOf(session.address) ?? "My wallet"}</b> <code>{short(session.address)}</code></span>
                {mode === "metamask" && <button className="btn ghost small" onClick={switchAccount}>Switch account</button>}
              </>
            ) : <Pill>Guest (read-only)</Pill>}
            <button className="btn ghost small" onClick={() => { setSession(null); setMode(null); }}>Sign out</button>
          </div>
        )}
      </header>

      {!session ? (
        <Welcome busy={busy} error={error} testIndex={testIndex} setTestIndex={setTestIndex}
          onTest={startTest} onMetaMask={startMetaMask} onGuest={() => start("guest", connectGuest)}
          onSwitch={async (chainId) => {
            try {
              if (!window.ethereum) throw new Error("MetaMask isn't installed. Get it free at metamask.io, then reload this page.");
              await switchMetaMaskTo(chainId);
              startMetaMask();
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

// Shows the screen for this account's role; asks once if the role is unknown.
function RoleScreen() {
  const { session } = useApp();
  const inbox = useInbox();
  if (!session.signer || session.isInsurer) return <><PageTitle role={session.signer ? "insurer" : "guest"} /><Insurer /></>;
  const me = session.address.toLowerCase();
  const role = inbox.people[me]?.role;
  if (!role || role === "insurer") {
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
  const Screen = { patient: Patient, hospital: Hospital, doctor: Doctor }[role];
  return <><PageTitle role={role} /><Screen /></>;
}

function PageTitle({ role }) {
  const { session } = useApp();
  const me = session.address?.toLowerCase();
  // Lets an account that picked the wrong role (or was used before) choose again. Not for the insurer.
  const changeRole = () => updateInbox((d) => { delete d.people[me].role; });
  return (
    <div className="page-title">
      <h2>{ROLES[role].label}{session.address && nameOf(session.address) ? ` · ${nameOf(session.address)}` : ""}</h2>
      <p className="muted">{ROLES[role].text}{role !== "insurer" && role !== "guest" && <> · <button className="linklike" onClick={changeRole}>Change role</button></>}</p>
    </div>
  );
}

function Welcome({ busy, error, testIndex, setTestIndex, onTest, onMetaMask, onGuest, onSwitch }) {
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
      <section className="card connect">
        <h3>Sign in</h3>
        {localChainAvailable && (
          <div className="option">
            <h4>Demo accounts <Pill tone="ok">no wallet needed</Pill></h4>
            <p className="muted">Fictional people on the local test chain. Switch person from the top bar.</p>
            <div className="row">
              <select value={testIndex} onChange={(e) => setTestIndex(Number(e.target.value))} aria-label="Start as">
                {TEST_ACCOUNTS.map((a) => <option key={a.index} value={a.index}>{a.name} · {ROLES[a.role].label}</option>)}
              </select>
              <button className="btn primary" disabled={busy} onClick={() => onTest(testIndex)}>Start</button>
            </div>
          </div>
        )}
        <div className="option">
          <h4>MetaMask</h4>
          <p className="muted">{isDeployed(SEPOLIA) ? "Use your own wallet on the Sepolia test network (free test ETH from a faucet)." : "Connect your wallet."}</p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={onMetaMask}>Connect MetaMask</button>
            {isDeployed(SEPOLIA) && <button className="btn ghost" disabled={busy} onClick={() => onSwitch(SEPOLIA)}>Switch MetaMask to Sepolia</button>}
            {localChainAvailable && <button className="btn ghost" disabled={busy} onClick={() => onSwitch(LOCAL)}>Add local chain to MetaMask</button>}
          </div>
        </div>
        {isDeployed(SEPOLIA) && (
          <div className="option">
            <h4>Just looking?</h4>
            <p className="muted">See the live, public claim settlements on Sepolia. No wallet needed.</p>
            <button className="btn ghost" disabled={busy} onClick={onGuest}>View as guest (read-only)</button>
          </div>
        )}
        {busy && <p className="muted"><span className="spinner" /> Connecting…</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
      </section>
      <Receipt example no="Claim no. 0003" paidOn="21 Nov 2026, 4:12 pm" policy={<code>0x1f3a…9c2e</code>}
        paidTo="Sanjeevani Multispeciality" amount="₹42,000" />
    </main>
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
