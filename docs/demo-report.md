# InsureTrust demo report

Generated 2026-11-22T23:47:26.399Z by `scripts/demo.ts` on a local Hardhat test chain (chain ID 31337).
**All patients, hospitals, policies and money are fictional. tINR is a test token with no real value.**

## Result: ✅ everything behaved as expected
- Insurance claims: 8/8 as expected
- Encrypted records & doctor access: 9/9 as expected

## Part 1 — Insurance claims (zero-knowledge proofs)

| # | Patient | Hospital | Scenario | Expected | Result | Details |
|---|---|---|---|---|---|---|
| 1 | Aarav (fictional) | Sanjeevani Multispeciality (fictional) | Appendectomy, ₹85,000 (Gold, limit ₹2,00,000) | PAID | ✅ PAID | Proof verified on-chain; ₹85,000 tINR sent to hospital (proof made in 1.9 s) |
| 2 | Aarav (fictional) | Sanjeevani Multispeciality (fictional) | Same claim submitted again | REJECTED | ✅ REJECTED | Contract refused: AlreadyPaid |
| 3 | Meera (fictional) | Narmada Heart Institute (fictional) | Cataract surgery, ₹60,000 (Silver, limit ₹50,000) | REJECTED | ✅ REJECTED | Circuit refused to create a proof: The amount is above the policy limit. |
| 4 | Kabir (fictional) | Sanjeevani Multispeciality (fictional) | Cataract surgery on an expired policy | REJECTED | ✅ REJECTED | Circuit refused to create a proof: The policy had expired on the treatment date. |
| 5 | Ishita (fictional) | Narmada Heart Institute (fictional) | Cosmetic surgery (not covered) | REJECTED | ✅ REJECTED | Circuit refused to create a proof: This procedure is not covered by the policy. |
| 6 | Meera (fictional) | Unlisted Clinic (NOT approved) | Claim from a hospital NOT on the approved list | REJECTED | ✅ REJECTED | Circuit refused to create a proof: This hospital is not on the insurer's approved list. |
| 7 | Ishita (fictional) | Narmada Heart Institute (fictional) | Stranger (not the patient) submits Ishita's proof | REJECTED | ✅ REJECTED | Contract refused: NotPolicyHolder |
| 8 | Ishita (fictional) | Narmada Heart Institute (fictional) | Knee replacement, ₹2,40,000 — Ishita submits | PAID | ✅ PAID | Proof verified on-chain; ₹2,40,000 tINR sent to hospital (proof made in 1.4 s) |

## What the insurer sees on the blockchain
| Claim | Policy fingerprint | Paid to (hospital wallet) | Amount |
|---|---|---|---|
| 0 | `0x248914…cb8b` | `0x996550…A4dc` | ₹85,000 |
| 1 | `0x11b88d…efee` | `0x976EA7…0aa9` | ₹2,40,000 |

Pool: started at ₹10,00,000, now ₹6,75,000.

## What stayed private
Never sent to the insurer or the blockchain: diagnosis, procedure name/code, treatment date, claim ID, policy limit, expiry date, covered-procedure list, hospital signing key.
The procedure names in the table above are shown only because this report is written from the demo's own (fictional) data.

## Part 2 — Encrypted medical records & doctor access

Storage used: local IPFS node (Kubo in Docker, http://ipfs:5001); offline mode, so files stay on this laptop and are not published to the public IPFS network

| # | Step | Expected | Result | Details |
|---|---|---|---|---|
| R1 | Aarav, Dr. Rao and a stranger unlock their health lockers (create keys from a wallet signature) | ALLOWED | ✅ ALLOWED | 3 public keys published on-chain (32 bytes each); private keys never leave each person's device |
| R2 | Sanjeevani writes Aarav's record, locks it, stores the locked file and adds it to Aarav's locker | ALLOWED | ✅ ALLOWED | Locked file 773 bytes, content ID `bafkreihw3bhe2…`; on-chain: content ID + a 92-byte locked key for Aarav |
| R3 | Aarav opens his own record | ALLOWED | ✅ ALLOWED | Decrypted on their device (condition: "Acute appendicitis"); view written to the on-chain access history |
| R4 | Dr. Rao tries to open it before Aarav gives access | BLOCKED | ✅ BLOCKED | Contract refused: NoAccess |
| R5 | Aarav gives Dr. Rao access for 7 days | ALLOWED | ✅ ALLOWED | Record key re-locked for Dr. Rao's public key; expires 2026-11-29 |
| R6 | Dr. Rao opens the record | ALLOWED | ✅ ALLOWED | Decrypted on their device (condition: "Acute appendicitis"); view written to the on-chain access history |
| R7 | A stranger copies Aarav's locked key from the public blockchain and tries to unlock it | BLOCKED | ✅ BLOCKED | Cannot unlock: the key was not made for this person |
| R8 | Aarav revokes Dr. Rao's access | ALLOWED | ✅ ALLOWED | Dr. Rao's locked key removed; the system now refuses his requests |
| R9 | Dr. Rao tries to open the record again | BLOCKED | ✅ BLOCKED | Contract refused: NoAccess |

### Access history (rebuilt from on-chain events)
| Block | Event | Who |
|---|---|---|
| 15 | Record added by | Sanjeevani |
| 16 | Record opened by | Aarav |
| 17 | Access granted to | Dr. Rao (fictional) |
| 18 | Record opened by | Dr. Rao (fictional) |
| 19 | Access revoked for | Dr. Rao (fictional) |

### What is stored where
| Where | What is there | Can others read the medical details? |
|---|---|---|
| IPFS, content ID `bafkreihw3bhe2lipjqnfwpdiwprxfnkn36wdtyccrbisxkujhxzvgd6uyi` (open http://127.0.0.1:8080/ipfs/bafkreihw3bhe2lipjqnfwpdiwprxfnkn36wdtyccrbisxkujhxzvgd6uyi to see the locked file) | The locked record, 773 bytes. First bytes: `0x7d826f418a03981d1a48d2bac6b028cb…` | No: it's unreadable without the record key |
| Blockchain (HealthRecords) | Content ID, patient and issuer addresses, 92-byte locked keys, access events | No: no medical data, and each locked key opens only with its owner's private key |
| Each person's own device (memory only) | Their private key and, once they open it, the readable record | Only that person |

Honest limits: revoking stops access through this system, but it cannot erase a copy Dr. Rao already saw. Addresses and timings on the blockchain are public.

## Setup used
- Approved hospitals: Sanjeevani Multispeciality (fictional), Narmada Heart Institute (fictional)
- Policies: Aarav (fictional) — Gold, limit ₹2,00,000, covers Appendectomy, Cataract surgery, Angioplasty; Meera (fictional) — Silver, limit ₹50,000, covers Appendectomy, Cataract surgery; Kabir (fictional) — Basic (EXPIRED), limit ₹30,000, covers Cataract surgery; Ishita (fictional) — Gold, limit ₹3,00,000, covers Appendectomy, Angioplasty, Knee replacement
- Contracts: InsureTrust `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`, ClaimVerifier `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, TestINR `0x5FbDB2315678afecb367f032d93F642f64180aa3`, HealthRecords `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6`
