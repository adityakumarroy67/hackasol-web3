# Hack-a-Sol 5.0 — Web3 Track · W3-01

**Privacy-Preserving Health Records & ZKP Insurance Claims**

> Project name: TBD

## Problem
Insurance claims force hospitals to expose diagnoses, prescriptions and treatment history to insurers. Records sit in centralised silos with little patient control, and settlement is slow, manual and fraud-prone.

## Solution
A hospital proves to an insurer, with a zero-knowledge proof, that a claim is valid. A smart contract verifies the proof and pays out automatically. The insurer never sees the patient's medical details, and the patient controls who can read their records.

## Requirements checklist (from W3-01)
- [ ] ZK proof that the hospital is on the approved list (Merkle membership)
- [ ] ZK proof that the policy is active (policy start ≤ claim date < policy expiry)
- [ ] ZK proof that the procedure is in the covered set and amount ≤ policy limit
- [ ] Contract verifies the proof, rejects replays (nullifier), and auto-releases payment
- [ ] Records encrypted off-chain (IPFS or encrypted storage), only hashes on-chain
- [ ] Patient grants and revokes doctor access
- [ ] Three-role UI: Patient → Hospital → Insurer
- [ ] Architecture + privacy threat-model diagram (on-chain vs off-chain)
- [ ] Bonus: on-chain audit trail · break-glass emergency access · FHIR-compatible records

**Public inputs:** claim amount (128-bit integer in token base units), policy commitment, claim nullifier, approved-hospital Merkle root, approved hospital's payout address, claim submission time (UTC Unix seconds), chain ID, and verifier contract address.
**Private proof inputs:** claim date and policy terms, procedure code, claim ID, hospital signature data, and membership witnesses. Diagnosis, prescriptions, treatment history, and record contents stay encrypted off-chain and are not part of this claim circuit.

**Local payment convention:** use one mock tINR ERC-20 with 2 decimal places, so amounts are integer paise. Each settlement deployment supports one fixed token. The real payment asset remains a separate decision.

## Tech Stack (planned)
- Circuits: Circom 2 + circomlib (Poseidon, Merkle, comparators), Groth16 via snarkjs
- Contracts: Solidity + Hardhat, snarkjs-generated Groth16 verifier
- Chain: Ethereum Sepolia testnet (local Hardhat node for dev)
- Frontend: React + Vite + ethers.js, in-browser proof generation with snarkjs
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
Open **http://localhost:5173** and choose **Local test accounts**. No wallet is needed: switch between insurer, hospitals, patients and a doctor from the top bar. The local chain resets when its container restarts; run `deploy:local` again after that.

**Demo story (about 3 minutes):**
1. **Hospital tab:** each hospital clicks "Create signing key". Dr. Rao clicks "Publish my encryption key".
2. **Patient tab** (Aarav): "Unlock my locker".
3. **Insurer tab:** tick both hospitals → "Save approved list on-chain", then issue a policy to Aarav.
4. **Patient tab:** "Share with hospital" (Sanjeevani).
5. **Hospital tab** (Sanjeevani): write an encrypted record, then "Create proof & send to patient". The proof is made in the browser in about 2 s.
6. **Patient tab:** "Approve & submit claim". The contract verifies the proof and pays. "Try to submit again" is refused.
7. Share the record with Dr. Rao, open it as Dr. Rao, then revoke. The access history shows every step.
8. **Insurer tab:** the paid claim, "verified on-chain", with no medical data.

**Tests**
```bash
docker compose run --rm dev npm run test:circuit  # 20 circuit tests
docker compose run --rm dev npm run test:records  # encryption tests, including a real-IPFS round trip
docker compose run --rm dev npm test              # 21 contract + website-interface tests (Hardhat)
docker compose run --rm dev npm run demo          # scripted end-to-end demo, writes docs/demo-report.md
node scripts/ui-test.mjs                          # clicks through the whole website in headless Chrome (run on the host)
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
`npm run circuit claim` recompiles the circuit and creates a **new random proving key and a new `contracts/ClaimVerifier.sol`**. The two must match, so only one person rebuilds for the final version, and everyone else uses the committed files.

## Deployed Contracts (testnet)
Network: **Ethereum Sepolia testnet** (chain ID 11155111). Source code verified on Blockscout and Sourcify.

| Contract | Role | Address (verified source) |
|----------|------|---------------------------|
| InsureTrust | Verifies claim proofs, blocks double payment, pays hospitals | [`0x09fb7E8D2Fff56e63523Cd538B78DD2517079BFa`](https://eth-sepolia.blockscout.com/address/0x09fb7E8D2Fff56e63523Cd538B78DD2517079BFa#code) |
| ClaimVerifier | Groth16 zero-knowledge proof verifier (generated by snarkjs) | [`0xe897Ab4167eC3DefB4586cF7Dc8Dd37DBfb18DBa`](https://eth-sepolia.blockscout.com/address/0xe897Ab4167eC3DefB4586cF7Dc8Dd37DBfb18DBa#code) |
| HealthRecords | Encrypted-record registry, patient grant/revoke, access history | [`0x18e8c638379a8095c5a199d650a33315f6251659`](https://eth-sepolia.blockscout.com/address/0x18e8c638379a8095c5a199d650a33315f6251659#code) |
| TestINR | Test payout token (2 decimals, no real value) | [`0xcb709f49266231574616FF354ADfD7DFecc9d23a`](https://eth-sepolia.blockscout.com/address/0xcb709f49266231574616FF354ADfD7DFecc9d23a#code) |

Insurer / deployer account: `0x8a5f90B074566e8cddBEe472C13F103c24C6b1D7`. Also listed on Sourcify: `https://sourcify.dev/server/repo-ui/11155111/<address>`.

## Live Link
**https://insuretrust.pages.dev** (hosted on Cloudflare Pages, connected to the Sepolia contracts above)
- **No wallet:** click **View as guest** to see the live pool and every paid, proof-verified claim.
- **With MetaMask on Sepolia:** use the full patient / hospital / insurer flow. Get free Sepolia test ETH from a faucet.
- On the hosted site, encrypted record files are kept in the visitor's browser (clearly labelled), because there's no IPFS node. The local Docker setup uses a real IPFS node.

## Team
TBD

## Credits
| Used for | Project | Licence |
|---|---|---|
| ZK circuit compiler | [circom](https://github.com/iden3/circom) 2.2.3 | GPL-3.0 |
| Circuit building blocks (Poseidon, EdDSA, comparators) | [circomlib](https://github.com/iden3/circomlib) | GPL-3.0 |
| Proof generation & Solidity verifier | [snarkjs](https://github.com/iden3/snarkjs) | GPL-3.0 |
| Poseidon / EdDSA in JavaScript | [circomlibjs](https://github.com/iden3/circomlibjs) | GPL-3.0 |
| Trusted-setup file (Powers of Tau, 2^15) | [PSE Perpetual Powers of Tau](https://github.com/privacy-scaling-explorations/perpetualpowersoftau), 80 contributions | public ceremony output |
| ERC-20 token base | [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) 5 | MIT |
| Contract development & tests | [Hardhat](https://hardhat.org) 3, [ethers](https://ethers.org) 6 | MIT |
| Local IPFS node | [Kubo](https://github.com/ipfs/kubo) v0.43.1 (Docker image) | MIT / Apache-2.0 |
| Frontend | [React](https://react.dev), [Vite](https://vite.dev) | MIT |
| Encryption | Web Crypto API (built into browsers and Node.js): AES-256-GCM, X25519, HKDF | n/a |

## AI Disclosure
AI coding assistant used: Claude Code (Anthropic) for scaffolding and code generation. All team members reviewed and can explain the code.
