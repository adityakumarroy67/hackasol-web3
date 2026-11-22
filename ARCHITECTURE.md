# Architecture & Development Plan — W3-01

Privacy-Preserving Health Records & ZKP Insurance Claims

## 1. System architecture

**Roles**
| Role | Holds | Does |
|---|---|---|
| **Regulator / Insurer admin** | Approved-hospital list | Publishes the Merkle root of licensed hospitals on-chain |
| **Insurer** | Policy terms it issued; a funded payout pool | Issues policies as on-chain *commitments*. Never sees medical data. |
| **Hospital** | A secret hospital key; the patient's treatment record | Writes and encrypts the record. Generates the ZK claim proof in the browser. |
| **Patient** | Their wallet; the policy details (secret salt); the record keys | Owns the records and grants or revokes doctor access. Claim review and submitter authorization still need to be finalized. |

```
                         ┌──────────────── Sepolia ────────────────┐
                         │  RecordRegistry      ClaimSettlement    │
                         │  - record hashes     - hospital root    │
                         │  - access grants     - policy commits   │
                         │  - audit events      - nullifiers       │
                         │                      - Groth16Verifier  │
                         │                      - payout (tINR)    │
                         └───▲──────────▲──────────────▲───────────┘
          register record,   │          │ submitClaim  │ set root, register
          grant/revoke       │          │ (proof)      │ policy, fund pool
                   ┌─────────┴──┐   ┌───┴────────┐   ┌─┴──────────┐
                   │  PATIENT   │◀──│  HOSPITAL  │   │  INSURER   │
                   │  (wallet)  │   │  (wallet)  │   │  (wallet)  │
                   └─────┬──────┘   └─────┬──────┘   └────────────┘
                         │ encrypted      │ encrypted record (FHIR JSON)
                         ▼ key shares     ▼
                   ┌─────────────────────────────┐
                   │ IPFS (Pinata): ciphertext   │
                   └─────────────────────────────┘
```

**Off-chain storage.** Records are encrypted with a random AES-256-GCM key `K` before upload. IPFS stores only this ciphertext, and Pinata keeps it pinned. The chain stores only the CID (a content address, so any tampering changes it) and hashes, never the record or `K`. A doctor with access fetches the ciphertext by CID and decrypts it with `K`.

**End-to-end flow**
1. **Onboarding.** The approved-hospital list entry must bind the hospital's proof-signing public key to its authorized payout address. The exact leaf encoding and hash still need to be selected. The regulator builds the Merkle tree and calls `setHospitalRoot(root)`.
2. **Policy.** The insurer authorizes `Poseidon(policyId, policyStart, policyExpiry, policyLimit, coveredRoot, policySalt)` and registers that commitment in the settlement contract. The policy limit uses the same integer unit as the contract's fixed payout token. The patient receives the full policy details off-chain (JSON or QR).
3. **Treatment.** The hospital writes a FHIR-shaped JSON record and encrypts it with a fresh AES-256-GCM key `K`. It uploads the ciphertext to IPFS. The patient registers `{CID, recordCommitment}` on-chain. `recordCommitment = Poseidon(procedureCode, diagnosisCode, treatmentDataHash, recordSalt)`.
4. **Access.** The patient wraps `K` for a doctor's public key and stores the wrapped key on-chain (`grant`). `revoke` deletes the grant and rotates `K`.
5. **Claim.** The hospital takes the policy details from the patient, generates the proof in the browser, and hands the proof package to the patient.
6. **Settlement.** An authorized submitter sends `submitClaim(proof, publicSignals)`. The contract verifies the proof and its state checks, then pays `hospitalPayoutAddress`. The insurer's dashboard shows the public claim data, a valid proof, and "Paid".

## 2. How the zero-knowledge proof works

**Public inputs** (visible to the insurer and on-chain):
| Signal | Why it's public |
|---|---|
| `approvedHospitalRoot` | The contract checks it equals the current approved-hospital root |
| `policyCommitment` | The contract checks the policy is registered and active |
| `claimNullifier` | The contract rejects it if already used (blocks replays) |
| `claimAmount` | The amount to pay |
| `hospitalPayoutAddress` | The contract sends payment to this hospital address; the proof links it to the approved hospital entry |
| `claimSubmissionTime` | The proof shows the private claim date is no later than this time; the contract checks it is not in the future |
| `chainId`, `verifyingContract` | The contract checks these match the current deployment, preventing proof reuse on another chain or contract |

The first four come from the problem statement. The payout address is additionally public because the contract must know where to send payment. The claim date remains private in the current rules draft. A public `recordCommitment` is a separate proposal and must be privacy-reviewed before it is added to the proof inputs.

**Private circuit inputs** (never revealed to the insurer or placed on-chain): the UTC Unix-second claim date; policy identifier, start and expiry dates, limit, covered-procedure root and secret salt; stable claim ID; hospital proof-signing key and its Merkle membership witness; procedure code and its covered-set witness; and hospital signature values. Diagnosis, prescriptions, history, and full record content remain encrypted off-chain and are not included in this claim circuit.

**Constraints the circuit enforces**
| # | Check | PS requirement |
|---|---|---|
| C1 | The hospital proof-signing key and payout address are bound to one entry under `approvedHospitalRoot` | Licensed hospital on the approved list and paid at its authorized address |
| C2 | The hidden policy terms open `policyCommitment`; the settlement contract checks insurer registration | Claim is tied to an insurer-authorized policy |
| C3 | `policyStart ≤ claimDate < expiry` | Policy is active |
| C4 | `MerkleRoot(procedureCode, coveredPath) == coveredRoot` | Procedure is in the covered set |
| C5 | `claimAmount ≤ limit` | Amount is within the limit |
| C6 | The hospital's signature covers the claim amount, private claim date, policy commitment, nullifier, payout address, stable claim ID, private procedure code, chain ID and verifier address | The hospital authorized these exact claim and deployment details |
| C7 | `Poseidon(1003, policyId, claimId, policySalt) == claimNullifier`; the contract rejects an already-used value | Replays using the same claim ID are blocked; new IDs for the same service require insurer-side duplicate controls |

The current draft uses Poseidon for policy and nullifier commitments and CircomLib EdDSA-Poseidon for hospital signatures. Dates and chain IDs use 64-bit range checks; claim amount and policy limit use 128-bit range checks. These formats require security review before real use.

**Size.** The current circuit compiled to 20,021 constraints. A Groth16 setup needs a Powers of Tau file with capacity of at least 2^15 (32,768). Browser proving time and on-chain gas have not yet been measured.

**Contract checks, in order:** verify the proof → the approved-hospital root is accepted → the policy commitment is authorized → `claimSubmissionTime <= block.timestamp` → `chainId == block.chainid` and `verifyingContract == address(this)` → the nullifier is unused → mark the nullifier used → transfer the amount to `hospitalPayoutAddress` → emit `ClaimSettled`.

## 3. How the tools connect

```
circuits/claim.circom ──circom──▶ claim.r1cs + claim.wasm
        │                                    │
        │       ptau + snarkjs groth16 setup + contributions
        │                                    ▼
        │                           claim_final.zkey ──▶ verification_key.json
        │                                    │
        │        snarkjs zkey export solidityverifier
        │                                    ▼
        │                         Groth16Verifier.sol ─┐
        │                                              ├─▶ Hardhat compile/test ─▶ Sepolia deploy ─▶ Etherscan verify
        │      RecordRegistry.sol, ClaimSettlement.sol ┘
        │
circomlibjs (Poseidon, Merkle in JS; must produce the same hashes as the circuit)
        │
React + Vite ── loads claim.wasm + claim_final.zkey (static assets)
   ├─ snarkjs.groth16.fullProve() in the browser ─▶ proof ─▶ ethers ─▶ submitClaim()
   ├─ Web Crypto AES-GCM encrypt ─▶ Pinata ─▶ IPFS CID ─▶ ethers ─▶ RecordRegistry
   └─ MetaMask (3 accounts: patient / hospital / insurer)
```

The repo will have four folders: `circuits/`, `contracts/` (a Hardhat project), `app/` (Vite) and `scripts/` (tree builder and end-to-end demo script). Nothing is shared between them except the build files.

## 4. Riskiest parts and the small prototypes that test them

| Risk | Prototype | Passes when | Est. |
|---|---|---|---|
| **The ZK toolchain on Windows** (circom → zkey → Solidity verifier → calldata format) | S1: tiny Poseidon-preimage circuit, through to a Hardhat test | The Hardhat test verifies a real proof, and fails with a tampered public signal | 1h |
| **Hash mismatch between JS and the circuit** (the #1 silent bug) | S2: circomlibjs builds a tree; the circuit proves membership | Member proves; non-member fails | 1h |
| **Proving in the browser** (Vite + snarkjs needs polyfills; zkey loading time) | S3: S2's circuit proved inside a Vite page | Proof in under 5 s; total download under 10 MB | 1h |
| **Sharing record keys between wallets** (MetaMask's built-in encryption is deprecated) | S4: derive an X25519 keypair from a wallet signature, wrap `K` A→B, round-trip through Pinata | Account B decrypts; after rotation, the old wrapped key fails | 1.5h |
| **Sepolia deploy + Etherscan verification** | S5: deploy and verify S1's verifier | Etherscan shows the verified checkmark | 0.5h |

S1–S3 come before everything else. If browser proving fails, the fallback is proving with snarkjs in a small local Node service.

## 5. Milestones

| # | Milestone | Deliverable | Done when | Est. |
|---|---|---|---|---|
| **M0** | Prototypes S1–S4 | Toolchain proven | All prototype pass criteria green | 3–4h |
| **M1** | Claim circuit | `claim.circom`, trusted setup, test vectors | 1 valid case passes; invalid cases fail: hospital not listed, expired policy, uncovered procedure, amount > limit, amount overflow, wrong record, tampered payout address | 4–5h |
| **M2** | Contracts | `RecordRegistry`, `ClaimSettlement`, verifier, mock token | Hardhat tests: valid claim pays; replay rejected; stale root, unknown policy, someone else's record, future date and empty pool all rejected | 3–4h |
| ★ | **Day 2 mid-evaluation target** | M0–M2 + `scripts/demo.ts` running the full flow on a local chain | One command shows a claim proved and paid, then a replay rejected | |
| **M3** | Storage + access | Encrypt, IPFS, grant/revoke, key rotation | A doctor reads the record; after revoke, re-fetching fails | 3h |
| **M4** | Three-role UI | Patient, Hospital and Insurer dashboards | The full demo runs in the browser with 3 MetaMask accounts | 6–8h |
| **M5** | Testnet | Sepolia deploy, Etherscan verification, hosted frontend (Vercel) | A judge can open the live link and the explorer links | 2h |
| **M6** | Bonus | Time-limited grants, on-chain audit events, break-glass access | Each emits events shown in an audit timeline | 2–3h |
| **M7** | Submission | Architecture + threat-model diagram, README, PDF deck, 2–3 min video | Every rulebook deliverable checked off | 3h |

Commit after every milestone, at minimum.

## 6. Security and privacy threat model

**Circuit and ZK**
- **Missing constraints.** Using `<--` without a matching `===`, or path index bits not forced to 0/1, lets someone forge proofs. Fix: use `<==` everywhere, force path bits binary, and write one failing test per constraint.
- **Field wrap-around in comparisons.** Each comparison input needs a range check matching its type. The current circuit uses 64 bits for dates and chain ID, and 128 bits for claim amount and policy limit.
- **Groth16 trusted setup.** Whoever holds the setup randomness ("toxic waste") can forge proofs. Fix: every team member adds a contribution, then a random beacon, disclosed in the README. PLONK avoids per-circuit setup but costs more gas and proves more slowly.
- **Proof malleability.** Groth16 proofs can be altered and stay valid, so the proof itself can't serve as a replay ID. Replays are keyed only on the nullifier.

**Contracts**
- **Front-running.** Someone copies a proof from the mempool and changes the payee. The proof and contract must bind and check `hospitalPayoutAddress`.
- **Replays.** Blocked by the nullifier mapping, set *before* the transfer (checks-effects-interactions order, so re-entering mid-payment can't double-pay).
- **Hospital list updates.** A proof made just before a root change would fail. Fix: accept roots from a short recent history. A de-listed hospital loses access within that window.
- **Admin control.** One key controls the root and policies. Acceptable for a demo; production needs a multisig.

**Privacy leaks the ZK proof does *not* solve**
- **Brute-forcing commitments.** Procedure codes are a small set. Without a random salt, the insurer could hash every code and find a match. Every commitment carries a random 254-bit salt.
- **The amount reveals the procedure.** If a procedure has a unique price, the public amount gives it away. Mitigation: round amounts into buckets (optional).
- **Hospital identity.** Paying a hospital address can reveal which hospital received the claim; a specialty hospital may reveal clues about the care. This is a known privacy trade-off in the selected hospital-payment flow. A fresh address per claim would need a trusted way to bind that address to the approved hospital.
- **Timing.** The record registration time and claim time can be correlated. Accepted and documented.

**Storage and access**
- **Revocation can't un-share.** A doctor who already decrypted a record keeps it. `K` is rotated so revocation blocks *future* reads.
- **Ciphertext on IPFS is public forever.** AES-256-GCM with a unique nonce per encryption.
- **Wallet-signature key derivation.** A phishing site could get the same signature. Fix: a fixed message tied to our domain.
- **Logging views.** On-chain view logs are best-effort: the app logs views, but decryption happens off-chain and can't be forced to log.

**Operations:** no keys in the repo (`.env` is gitignored), testnet only, and only synthetic patient data.

## 7. W3-01 requirements → implementation

| Requirement | Implemented by | How it's shown in the demo |
|---|---|---|
| Hospital on approved list (Merkle) | C1 + `hospitalRoot` | A de-listed hospital's proof fails |
| Active policy (expiry > claim date) | C2, C3 | An expired policy's proof fails |
| Covered procedure, amount ≤ limit | C4, C5 | Uncovered procedure or over-limit amount fails |
| Contract verifies the proof | `Groth16Verifier` in `submitClaim` | Etherscan transaction |
| Rejects duplicates/replays (nullifier) | `nullifierUsed` | Resubmitting is reverted live |
| Auto payout | Token transfer in the same transaction | Recipient balance goes up |
| Encrypted off-chain records, only hashes on-chain | AES-GCM + IPFS + `RecordRegistry` | Show the unreadable ciphertext on IPFS |
| Patient grants/revokes doctor access | `grant`/`revoke` + key rotation | Doctor reads, then is revoked and can't |
| Three-role UI | React dashboards | Patient → Hospital → Insurer walkthrough |
| Public/private split as specified | Circuit signal layout | Insurer view shows public signals only |
| Testnet contracts + proof flow + frontend | M5 | Live link + verified contracts |
| Architecture + threat-model diagram | M7 | Diagram slide and README |
| *Bonus:* time-limited grants + audit trail | `expiresAt` + events | Audit timeline |
| *Bonus:* break-glass access | Patient pre-names an emergency guardian; time-limited access, logged | Responder access shows up in the audit log |
| *Bonus:* FHIR records | Records stored as FHIR `Bundle` JSON | Show the record JSON |

## Open decisions

1. Team size and skills, to split M1–M4 in parallel.
2. Who submits and who gets paid. Payment recipient is set to the approved hospital's authorized payout address. Who submits the claim still needs a decision.
3. Local payout asset: one mock ERC-20 "tINR" with 2 decimals (paise units) per settlement deployment. The real payment asset remains open.
4. Key sharing. Proposed: wallet-signature-derived X25519 keys (tweetnacl). Alternative: Lit Protocol.
5. Tie each claim to a registered record (C6). Proposed: yes.
6. Policy limit: per claim (proposed) or a running total.
7. Trusted setup. Proposed: Groth16 with a contribution from each member. Alternative: PLONK.
8. Bonus scope. Proposed: audit trail, break-glass and FHIR.
9. Project name.
