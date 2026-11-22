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
- Storage: encrypted records (AES-GCM, Web Crypto) on IPFS

## Setup
Requirements: Node 24, [circom 2.2.3](https://github.com/iden3/circom/releases/tag/v2.2.3).

```bash
npm ci
npm run circuit claim     # compile circuit, Groth16 setup (PSE Perpetual Powers of Tau), export ClaimVerifier.sol
npm test                  # Hardhat: circuit + contract tests
npm run test:app          # frontend unit tests
```

> **Windows note:** if Smart App Control / Application Control blocks Hardhat's native binary (`edr.win32-x64-msvc.node`), run the commands inside WSL2 (Ubuntu) with Linux Node + circom installed.

## Deployed Contracts (testnet)
| Contract | Network | Address / Explorer (verified) |
|----------|---------|-------------------------------|
| TBD      | TBD     | TBD                           |

## Live Link
TBD

## Team
TBD

## Credits
Libraries, frameworks and templates used (with licences): TBD

## AI Disclosure
AI coding assistant used: Claude Code (Anthropic) for scaffolding and code generation. All team members reviewed and can explain the code.
