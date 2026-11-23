// Blockchain connection: networks, contract addresses, wallets, and plain-language errors.
import { BrowserProvider, Contract, HDNodeWallet, Interface, JsonRpcProvider } from "ethers";
import deployments from "./deployments.json";
import { HEALTH_RECORDS_ABI, INSURE_TRUST_ABI, TOKEN_ABI } from "./abi.js";

export const LOCAL = 31337;
export const SEPOLIA = 11155111;
export const NETWORKS = {
  [LOCAL]: { name: "Local test chain", explorer: null },
  [SEPOLIA]: { name: "Sepolia testnet", explorer: "https://sepolia.etherscan.io", rpc: "https://ethereum-sepolia-rpc.publicnode.com" },
};

// The dev server (Docker) forwards /rpc to the local chain. The hosted website has no local chain.
export const localChainAvailable = import.meta.env.DEV && Boolean(deployments[LOCAL]);
export const isDeployed = (chainId) => Boolean(deployments[chainId]);

// Hardhat's PUBLIC test accounts: they only hold fake money on the local chain. Never use them elsewhere.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const TEST_ACCOUNTS = [
  { index: 0, name: "InsureTrust Insurance", role: "insurer" },
  { index: 1, name: "Aarav", role: "patient" },
  { index: 2, name: "Meera", role: "patient" },
  { index: 3, name: "Kabir", role: "patient" },
  { index: 4, name: "Ishita", role: "patient" },
  { index: 5, name: "Sanjeevani Multispeciality", role: "hospital" },
  { index: 6, name: "Narmada Heart Institute", role: "hospital" },
  { index: 7, name: "Unlisted Clinic", role: "hospital" },
  { index: 8, name: "Dr. Rao", role: "doctor" },
];
let testRoot;
const testWallet = (index) => (testRoot ??= HDNodeWallet.fromPhrase(TEST_MNEMONIC, undefined, "m/44'/60'/0'/0")).deriveChild(index);
export const testAccountAddress = (index) => testWallet(index).address;

let localProvider;
export async function connectTestAccount(index) {
  localProvider ??= new JsonRpcProvider(new URL("/rpc", location.origin).href, LOCAL, { staticNetwork: true, pollingInterval: 1000 });
  return makeSession(localProvider, testWallet(index).connect(localProvider), LOCAL);
}

export async function connectMetaMask() {
  if (!window.ethereum) throw new Error("MetaMask isn't installed. Get it free at metamask.io, then reload this page.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const { chainId } = await provider.getNetwork();
  return makeSession(provider, await provider.getSigner(), Number(chainId));
}

// Read-only view of the public testnet, no wallet needed (e.g. for judges).
export async function connectGuest() {
  return makeSession(new JsonRpcProvider(NETWORKS[SEPOLIA].rpc, SEPOLIA, { staticNetwork: true }), null, SEPOLIA);
}

export async function switchMetaMaskTo(chainId) {
  const hex = "0x" + chainId.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if (e?.code !== 4902 || chainId !== LOCAL) throw e;
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
      chainId: hex, chainName: "InsureTrust local chain", rpcUrls: ["http://127.0.0.1:8545"],
      nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 },
    }] });
  }
}

async function makeSession(provider, signer, chainId) {
  const deployment = deployments[chainId];
  if (!deployment) {
    const where = Object.keys(deployments).map((id) => NETWORKS[id]?.name ?? `chain ${id}`).join(" or ");
    throw new Error(`InsureTrust isn't deployed on ${NETWORKS[chainId]?.name ?? `chain ${chainId}`}. Switch your wallet to ${where || "a supported network"}.`);
  }
  const runner = signer ?? provider;
  return {
    chainId,
    network: NETWORKS[chainId] ?? { name: `Chain ${chainId}` },
    provider,
    signer,
    address: signer ? await signer.getAddress() : null,
    deployment,
    isInsurer: Boolean(signer) && (await signer.getAddress()).toLowerCase() === deployment.insurer.toLowerCase(),
    insureTrust: new Contract(deployment.insureTrust, INSURE_TRUST_ABI, runner),
    healthRecords: new Contract(deployment.healthRecords, HEALTH_RECORDS_ABI, runner),
    token: new Contract(deployment.token, TOKEN_ABI, runner),
  };
}

// Send a transaction and wait until it's in a block.
export async function send(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

export const txUrl = (session, hash) => (session.network.explorer ? `${session.network.explorer}/tx/${hash}` : null);
export const addressUrl = (session, address) => (session.network.explorer ? `${session.network.explorer}/address/${address}` : null);

// ---------- errors in plain words ----------
const MESSAGES = {
  NotInsurer: "Only the insurer's account can do this.",
  UnknownHospitalRoot: "The insurer's approved-hospital list changed after this proof was made. The hospital must make a new proof.",
  NotPolicyHolder: "Only the patient who owns this policy can submit the claim (or the policy was revoked).",
  AlreadyPaid: "This claim was already paid. The same claim can't be paid twice.",
  BadSubmissionTime: "This proof is too old (over 24 hours) or dated in the future. Ask the hospital for a new one.",
  WrongDeployment: "This proof was made for a different network or contract.",
  InvalidProof: "The proof didn't verify: something in the claim was changed after it was made.",
  ERC20InsufficientBalance: "The insurer's money pool is too low. The insurer must add test money first.",
  NotPatient: "Only the patient who owns this record can do this.",
  NoAccess: "No access to this record (never given, expired, or revoked).",
  BadExpiry: "The access end date must be in the future.",
  CannotRevokePatient: "The patient can't remove their own access.",
  UnknownRecord: "This record doesn't exist.",
  EmptyKey: "The encrypted key is missing.",
};
const interfaces = [INSURE_TRUST_ABI, HEALTH_RECORDS_ABI, TOKEN_ABI].map((abi) => new Interface(abi));

export function explainError(e) {
  if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) return "You cancelled the request in your wallet.";
  if (e?.code === "INSUFFICIENT_FUNDS") return "This account has no test ETH to pay the network fee.";
  if (e?.revert?.name) return MESSAGES[e.revert.name] ?? e.revert.name;
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  for (const iface of interfaces) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return MESSAGES[parsed.name] ?? parsed.name;
    } catch {}
  }
  if (e?.name === "OperationError") return "This key can't be unlocked by this account.";
  return e?.shortMessage ?? e?.message ?? String(e);
}
