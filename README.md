# InsureTrust

**Privacy-preserving health records and zero-knowledge insurance claims.** Hack-a-Sol 5.0 · Web3 track · W3-01 · Team **AvivCrew**

🌐 **Live:** https://insuretrust.pages.dev · 📜 **Contracts:** Sepolia, source verified ([below](#deployed-contracts-testnet))

## Problem
Insurance claims force hospitals to expose diagnoses, prescriptions and treatment history to insurers. Records sit in centralised silos with little patient control, and settlement is slow, manual and fraud-prone.

## Solution
A hospital proves to an insurer, with a zero-knowledge proof, that a claim is valid. A smart contract verifies the proof and pays out automatically. The insurer never sees the patient's medical details, and the patient controls who can read their records.

## How it works
1. **Insurer** approves hospitals (only a Merkle root of the list goes on-chain) and issues a policy (only a Poseidon commitment goes on-chain).
2. **Hospital** writes a FHIR discharge summary and bill, encrypts it in the browser (AES-256-GCM), stores it on IPFS, and locks the key for the patient (X25519). On-chain: content ID + locked key only.
3. **Hospital** creates a Groth16 proof **in the browser (~2 s)** that the claim is signed by an approved hospital, the policy was active, the procedure is covered and the amount is within the limit, plus a one-time nullifier.
4. **Patient** approves. `InsureTrust.sol` verifies the proof, rejects replays and pays the hospital automatically in test tINR.
5. **Patient** shares a record with a doctor for a set time, and can revoke it. Every grant, view and revocation is logged on-chain.

The insurer sees the amount, policy fingerprint and payout wallet only. It never sees the diagnosis, procedure, treatment date, prescriptions or the record.

## Requirements checklist (from W3-01)
- [x] ZK proof that the hospital is on the approved list (Merkle membership), plus the hospital's EdDSA signature over the claim
- [x] ZK proof that the policy is active (policy start ≤ claim date < policy expiry)
- [x] ZK proof that the procedure is in the covered set and amount ≤ policy limit
- [x] Contract verifies the proof, rejects replays (nullifier), and auto-releases payment
- [x] Records encrypted off-chain (IPFS), only content IDs and locked keys on-chain
- [x] Patient grants and revokes doctor access
- [x] Three-role UI: Patient → Hospital → Insurer (+ Doctor)
- [ ] Architecture + privacy threat-model diagram (on-chain vs off-chain): in progress
- [x] Bonus: time-bound access with an on-chain audit trail (grant / view / revoke)
- [x] Bonus: HL7 FHIR-shaped records (Patient, Encounter, Condition with ICD-10, Procedure, MedicationRequest, Practitioner, Organization, Invoice)
- [ ] Bonus: break-glass emergency access

**Public inputs:** claim amount (128-bit integer in token base units), policy commitment, claim nullifier, approved-hospital Merkle root, approved hospital's payout address, claim submission time (UTC Unix seconds), chain ID, and verifier contract address.
**Private proof inputs:** claim date and policy terms, procedure code, claim ID, hospital signature data, and membership witnesses. Diagnosis, prescriptions, treatment history, and record contents stay encrypted off-chain and are not part of this claim circuit.

**Local payment convention:** use one mock tINR ERC-20 with 2 decimal places, so amounts are integer paise. Each settlement deployment supports one fixed token. The real payment asset remains a separate decision.

## Tech Stack
- Circuits: Circom 2 + circomlib (Poseidon, Merkle, comparators), Groth16 via snarkjs
- Contracts: Solidity + Hardhat, snarkjs-generated Groth16 verifier
- Chain: Ethereum Sepolia testnet (local Hardhat node for dev)
- Frontend: React + Vite + ethers.js, in-browser proof generation with snarkjs, hosted on Cloudflare Pages
- Storage: records encrypted with AES-256-GCM, record keys shared per person with X25519 (Web Crypto); encrypted files on IPFS (local Kubo node in Docker); only content IDs and wrapped keys on-chain
- Dev environment: Docker Compose (Node 24 + circom toolbox, IPFS node)

## Setup

### Option A: Docker (recommended, and the same on every laptop)
Requirements: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (free for personal and education use). No Node, circom or WSL setup needed.

**Run the website**
```bash
docker compose run --rm dev npm ci                # first time only: install packages
docker compose up -d                              # IPFS node + local blockchain + website
docker compose run --rm dev npm run deploy:local  # put the contracts on the local blockchain
```
Open **http://localhost:5173** → **Demo accounts** → Start. No wallet is needed: each fictional person (insurer, patients, hospitals, a doctor) gets only their own screen, and you switch person from the top bar. The local chain resets when its container restarts; run `deploy:local` again after that.

**Demo story (about 3 minutes):**
1. **Sanjeevani**, **Narmada** → *Register hospital*. **Dr. Rao** → *Register as doctor*. **Aarav** → *Create my health locker*.
2. **Insurer** → approve both hospitals → *Save approved list on-chain* → issue a Gold policy to Aarav.
3. **Aarav** → My insurance → *Share with hospital* (Sanjeevani). This also lets Sanjeevani add records to his locker on-chain; no other account can.
4. **Sanjeevani** → write the discharge summary + bill → *Prepare an insurance claim* → pick the bill → *Create proof & send to patient* (about 2 s, in the browser). Rule failures (over limit, not covered, expired policy) are explained before any proof is made.
5. **Aarav** → *Approve & submit claim* → paid. *Verify it can't be paid twice* → refused.
6. **Aarav** → share the record with Dr. Rao for 7 days → **Dr. Rao** opens it → **Aarav** revokes. The access history shows every step.
7. **Insurer** → the paid claim, "verified on-chain", with no medical data.

**Tests**
```bash
docker compose run --rm dev npm run test:circuit  # 21 circuit tests
docker compose run --rm dev npm run test:records  # encryption tests, including a real-IPFS round trip
docker compose run --rm dev npm test              # 21 contract + website-interface tests (Hardhat)
docker compose run --rm dev npm run demo          # scripted end-to-end demo, writes docs/demo-report.md
node scripts/ui-test.mjs                          # clicks through the whole website (20 steps) in headless Chrome, on the host
```
Open `http://127.0.0.1:8080/ipfs/<cid>` to see an encrypted record as IPFS stores it (unreadable without the key).

**Deploy (needs `.env`; copy `.env.example` and fill it in. Never commit it.)**
```bash
docker compose run --rm dev npm run deploy:sepolia  # contracts on the Sepolia testnet
docker compose run --rm dev npm run pages:deploy    # build the website and publish it on Cloudflare Pages
```

### Option B: Native
Requirements: Node 24, [circom 2.2.3](https://github.com/iden3/circom/releases/tag/v2.2.3).

```bash
npm ci
npm run test:circuit && npm run test:records && npm test && npm run demo
```
Without an IPFS node, the demo stores encrypted files in a local `.storage/` folder. It's clearly labelled, and the content IDs are the same as IPFS's.

> **Windows note:** if Smart App Control / Application Control blocks Hardhat's native binary (`edr.win32-x64-msvc.node`), use Option A (Docker) or run inside WSL2.

### Rebuilding the circuit (one person only)
`npm run circuit -- claim --new-setup` recompiles the circuit and creates a **new random proving key and a new `contracts/ClaimVerifier.sol`**. The committed files match the contracts deployed on Sepolia, and every test uses them, so rebuilding means redeploying. Without `--new-setup` the script refuses to overwrite them.

## Deployed Contracts (testnet)
Network: **Ethereum Sepolia testnet** (chain ID 11155111). Source code verified on Blockscout and Sourcify.

| Contract | Role | Address (verified source) |
|----------|------|---------------------------|
| InsureTrust | Verifies claim proofs, blocks double payment, pays hospitals | [`0x2bF4749Dd6dDeB82d267e503EFA471105027BD29`](https://eth-sepolia.blockscout.com/address/0x2bF4749Dd6dDeB82d267e503EFA471105027BD29#code) |
| ClaimVerifier | Groth16 zero-knowledge proof verifier (generated by snarkjs) | [`0x9C078efeFDB278a579DDC953035842550f79b7c6`](https://eth-sepolia.blockscout.com/address/0x9C078efeFDB278a579DDC953035842550f79b7c6#code) |
| HealthRecords | Encrypted-record registry, patient-approved hospitals, grant/revoke, access history | [`0x9B217447D72Ca408df7104EEC64697740EC741E9`](https://eth-sepolia.blockscout.com/address/0x9B217447D72Ca408df7104EEC64697740EC741E9#code) |
| TestINR | Test payout token (2 decimals, no real value) | [`0xE88Ff848719320a0b269B356B505CfaD63Ce9E84`](https://eth-sepolia.blockscout.com/address/0xE88Ff848719320a0b269B356B505CfaD63Ce9E84#code) |

Insurer / deployer account: `0x8a5f90B074566e8cddBEe472C13F103c24C6b1D7`. Also listed on Sourcify: `https://sourcify.dev/server/repo-ui/11155111/<address>`.

## Live Link
**https://insuretrust.pages.dev** (hosted on Cloudflare Pages, connected to the Sepolia contracts above)
- **No wallet:** click **View as guest** to see the live pool and every paid, proof-verified claim.
- **With MetaMask on Sepolia:** each role is a separate MetaMask account. On first visit an account picks its role (patient, hospital or doctor); the deployer account is the insurer. Switch account in MetaMask and the site follows. Get free Sepolia test ETH from a faucet.
- On the hosted site, encrypted record files are kept in the visitor's browser (clearly labelled), because there's no IPFS node. The local Docker setup uses a real IPFS node.

## Team
**AvivCrew**
- [adityakumarroy67](https://github.com/adityakumarroy67)
- [adityagotmaray](https://github.com/adityagotmaray)
- [anuragpandey-ship-it](https://github.com/anuragpandey-ship-it)

## Credits
| Used for | Project | Licence |
|---|---|---|
| ZK circuit compiler | [circom](https://github.com/iden3/circom) 2.2.3 | GPL-3.0 |
| Circuit building blocks (Poseidon, EdDSA, comparators) | [circomlib](https://github.com/iden3/circomlib) | GPL-3.0 |
| Proof generation & Solidity verifier | [snarkjs](https://github.com/iden3/snarkjs) | GPL-3.0 |
| Poseidon hash in JavaScript (browser + Node) | [poseidon-lite](https://github.com/vimwitch/poseidon-lite) | MIT |
| Baby Jubjub curve maths for EdDSA signing | [@zk-kit/baby-jubjub](https://github.com/privacy-scaling-explorations/zk-kit) | MIT |
| Trusted-setup file (Powers of Tau, 2^15) | [PSE Perpetual Powers of Tau](https://github.com/privacy-scaling-explorations/perpetualpowersoftau), 80 contributions | public ceremony output |
| ERC-20 token base | [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) 5 | MIT |
| Contract development & tests | [Hardhat](https://hardhat.org) 3, [ethers](https://ethers.org) 6 | MIT |
| Local IPFS node | [Kubo](https://github.com/ipfs/kubo) v0.43.1 (Docker image) | MIT / Apache-2.0 |
| Frontend | [React](https://react.dev), [Vite](https://vite.dev) | MIT |
| Interface icons | [Lucide](https://lucide.dev) (lucide-react) | ISC |
| Interface typefaces | [IBM Plex Sans and Plex Mono](https://github.com/IBM/plex), via Google Fonts | SIL OFL 1.1 |
| UI redesign method | [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (@heydamir), a Claude Code skill | CC BY 4.0 |
| Hosting / deploy tool | [Cloudflare Pages](https://pages.cloudflare.com), [Wrangler](https://github.com/cloudflare/workers-sdk) | MIT / Apache-2.0 |
| Contract source verification | [Blockscout](https://eth-sepolia.blockscout.com), [Sourcify](https://sourcify.dev) | public services |
| Encryption | Web Crypto API (built into browsers and Node.js): AES-256-GCM, X25519, HKDF | n/a |

## AI Disclosure
AI coding assistant used: Claude Code (Anthropic) for scaffolding, code generation, testing and deployment scripts. All team members reviewed and can explain the code.
