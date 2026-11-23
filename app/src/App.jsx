// App shell: welcome / connect, header with network + storage + account, role tabs.
import { useEffect, useReducer, useState } from "react";
import {
  LOCAL, SEPOLIA, TEST_ACCOUNTS, addressUrl, connectGuest, connectMetaMask, connectTestAccount, explainError,
  isDeployed, localChainAvailable, switchMetaMaskTo, testAccountAddress,
} from "./chain.js";
import Hospital from "./Hospital.jsx";
import Insurer from "./Insurer.jsx";
import Patient from "./Patient.jsx";
import { nameOf, openInbox, openStorage, resetInbox, updateInbox } from "./store.js";
import { AppContext, Pill, short } from "./ui.jsx";

const TABS = [
  { id: "patient", label: "Patient", icon: "🧑‍⚕️" },
  { id: "hospital", label: "Hospital & doctor", icon: "🏥" },
  { id: "insurer", label: "Insurer", icon: "🛡️" },
];
const TAB_FOR_ROLE = { patient: "patient", hospital: "hospital", doctor: "hospital", insurer: "insurer" };

export default function App() {
  const [session, setSession] = useState(null);
  const [mode, setMode] = useState(null); // "test" | "metamask" | "guest"
  const [testIndex, setTestIndex] = useState(1);
  const [storage, setStorage] = useState(null);
  const [tab, setTab] = useState("patient");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, refresh] = useReducer((x) => x + 1, 0);

  useEffect(() => { openStorage().then(setStorage); }, []);

  async function start(nextMode, connect, nextTab) {
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
      // Open the tab that fits this account (known demo accounts on the local chain).
      const known = s.chainId === LOCAL && s.address && TEST_ACCOUNTS.find((a) => testAccountAddress(a.index).toLowerCase() === s.address.toLowerCase());
      const tabForAccount = nextTab ?? (known ? TAB_FOR_ROLE[known.role] : s.isInsurer ? "insurer" : null);
      if (tabForAccount) setTab(tabForAccount);
      refresh();
    } catch (e) {
      console.error(e);
      setError(explainError(e));
    }
    setBusy(false);
  }
  const startTest = (index) => { setTestIndex(index); start("test", () => connectTestAccount(index), TAB_FOR_ROLE[TEST_ACCOUNTS[index].role]); };
  const startMetaMask = () => start("metamask", connectMetaMask);

  // Follow MetaMask account / network switches.
  useEffect(() => {
    if (mode !== "metamask" || !window.ethereum?.on) return;
    window.ethereum.on("accountsChanged", startMetaMask);
    window.ethereum.on("chainChanged", startMetaMask);
    return () => {
      window.ethereum.removeListener("accountsChanged", startMetaMask);
      window.ethereum.removeListener("chainChanged", startMetaMask);
    };
  }, [mode]);

  if (!storage) return null;
  return (
    <AppContext.Provider value={{ session, storage, refresh, refreshKey }}>
      <header className="topbar">
        <div className="brand"><span className="logo">🛡️</span> InsureTrust <small>private health insurance claims</small></div>
        {session && (
          <div className="status">
            <Pill tone="info">{session.network.name}</Pill>
            <Pill tone={storage.kind === "ipfs" ? "ok" : "warn"}>Files: {storage.label}</Pill>
            {mode === "test" ? (
              <select value={testIndex} onChange={(e) => startTest(Number(e.target.value))} aria-label="Test account">
                {TEST_ACCOUNTS.map((a) => <option key={a.index} value={a.index}>{a.name} · {a.role}</option>)}
              </select>
            ) : session.address ? (
              <span className="who"><b>{nameOf(session.address) ?? "My wallet"}</b> <code>{short(session.address)}</code></span>
            ) : <Pill>Guest (read-only)</Pill>}
            <button className="btn ghost small" onClick={() => { setSession(null); setMode(null); }}>Change</button>
          </div>
        )}
      </header>
      <p className="banner">Demo with <b>fictional people</b> and <b>test money</b> (tINR has no value). Never enter real medical data.</p>

      {!session ? (
        <Welcome busy={busy} error={error} testIndex={testIndex} setTestIndex={setTestIndex}
          onTest={startTest} onMetaMask={startMetaMask} onGuest={() => start("guest", connectGuest, "insurer")}
          onSwitch={async (chainId) => {
            try {
              if (!window.ethereum) throw new Error("MetaMask isn't installed. Get it free at metamask.io, then reload this page.");
              await switchMetaMaskTo(chainId);
              startMetaMask();
            } catch (e) { setError(explainError(e)); }
          }} />
      ) : (
        <>
          <nav className="tabs">
            {TABS.map((t) => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>)}
          </nav>
          <main key={`${session.chainId}-${session.address}`}>
            {tab === "patient" ? <Patient /> : tab === "hospital" ? <Hospital /> : <Insurer />}
          </main>
          <Footer session={session} mode={mode} />
        </>
      )}
    </AppContext.Provider>
  );
}

function Welcome({ busy, error, testIndex, setTestIndex, onTest, onMetaMask, onGuest, onSwitch }) {
  return (
    <main className="welcome">
      <section className="hero">
        <h1>Insurance claims that prove themselves, without revealing your diagnosis.</h1>
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
        <h3>Get started</h3>
        {localChainAvailable && (
          <div className="option">
            <h4>Local test accounts <Pill tone="ok">no wallet needed</Pill></h4>
            <p className="muted">Fake money on the local test chain. Switch between patient, hospital and insurer in one click.</p>
            <div className="row">
              <select value={testIndex} onChange={(e) => setTestIndex(Number(e.target.value))} aria-label="Start as">
                {TEST_ACCOUNTS.map((a) => <option key={a.index} value={a.index}>{a.name} · {a.role}</option>)}
              </select>
              <button className="btn primary" disabled={busy} onClick={() => onTest(testIndex)}>Start</button>
            </div>
          </div>
        )}
        <div className="option">
          <h4>MetaMask</h4>
          <p className="muted">{isDeployed(SEPOLIA) ? "Use your own test wallet on the Sepolia test network (free test ETH from a faucet)." : "Connect your wallet."}</p>
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
        {error && <p className="err">⚠ {error}</p>}
      </section>
    </main>
  );
}

function Footer({ session, mode }) {
  const d = session.deployment;
  const link = (label, address) => {
    const url = addressUrl(session, address);
    return url ? <a href={url} target="_blank" rel="noreferrer">{label} ↗</a> : <span title={address}>{label} <code>{short(address)}</code></span>;
  };
  return (
    <footer>
      <div>Contracts on {session.network.name}: {link("InsureTrust", d.insureTrust)} · {link("HealthRecords", d.healthRecords)} · {link("ClaimVerifier", d.verifier)} · {link("tINR", d.token)}</div>
      <div className="muted">Hack-a-Sol 5.0 · Web3 track W3-01 · fictional data only
        {mode === "test" && <> · <button className="linklike" onClick={() => { resetInbox(); location.reload(); }}>clear this browser's demo data</button></>}
      </div>
    </footer>
  );
}
