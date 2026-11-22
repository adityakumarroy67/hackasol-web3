# InsureTrust demo report

Generated 2026-11-22T22:46:12.137Z by `scripts/demo.ts` on a local Hardhat test chain (chain ID 31337).
**All patients, hospitals, policies and money are fictional. tINR is a test token with no real value.**

## Result: ✅ every scenario behaved as expected (8/8)

| # | Patient | Hospital | Scenario | Expected | Result | Details |
|---|---|---|---|---|---|---|
| 1 | Aarav (fictional) | Sanjeevani Multispeciality (fictional) | Appendectomy, ₹85,000 (Gold, limit ₹2,00,000) | PAID | ✅ PAID | Proof verified on-chain; ₹85,000 tINR sent to hospital (proof made in 1.9 s) |
| 2 | Aarav (fictional) | Sanjeevani Multispeciality (fictional) | Same claim submitted again | REJECTED | ✅ REJECTED | Contract refused: AlreadyPaid |
| 3 | Meera (fictional) | Narmada Heart Institute (fictional) | Cataract surgery, ₹60,000 (Silver, limit ₹50,000) | REJECTED | ✅ REJECTED | Circuit refused to create a proof (a rule failed) |
| 4 | Kabir (fictional) | Sanjeevani Multispeciality (fictional) | Cataract surgery on an expired policy | REJECTED | ✅ REJECTED | Circuit refused to create a proof (a rule failed) |
| 5 | Ishita (fictional) | Narmada Heart Institute (fictional) | Cosmetic surgery (not covered) | REJECTED | ✅ REJECTED | Circuit refused to create a proof (a rule failed) |
| 6 | Meera (fictional) | Unlisted Clinic (NOT approved) | Claim from a hospital NOT on the approved list | REJECTED | ✅ REJECTED | Circuit refused to create a proof (a rule failed) |
| 7 | Ishita (fictional) | Narmada Heart Institute (fictional) | Stranger (not the patient) submits Ishita's proof | REJECTED | ✅ REJECTED | Contract refused: NotPolicyHolder |
| 8 | Ishita (fictional) | Narmada Heart Institute (fictional) | Knee replacement, ₹2,40,000 — Ishita submits | PAID | ✅ PAID | Proof verified on-chain; ₹2,40,000 tINR sent to hospital (proof made in 1.2 s) |

## What the insurer sees on the blockchain
| Claim | Policy fingerprint | Paid to (hospital wallet) | Amount |
|---|---|---|---|
| 0 | `0x2bec33…cc95` | `0x996550…A4dc` | ₹85,000 |
| 1 | `0x2588f3…8907` | `0x976EA7…0aa9` | ₹2,40,000 |

Pool: started at ₹10,00,000, now ₹6,75,000.

## What stayed private
Never sent to the insurer or the blockchain: diagnosis, procedure name/code, treatment date, claim ID, policy limit, expiry date, covered-procedure list, hospital signing key.
The procedure names in the table above are shown only because this report is written from the demo's own (fictional) data.

## Setup used
- Approved hospitals: Sanjeevani Multispeciality (fictional), Narmada Heart Institute (fictional)
- Policies: Aarav (fictional) — Gold, limit ₹2,00,000, covers Appendectomy, Cataract surgery, Angioplasty; Meera (fictional) — Silver, limit ₹50,000, covers Appendectomy, Cataract surgery; Kabir (fictional) — Basic (EXPIRED), limit ₹30,000, covers Cataract surgery; Ishita (fictional) — Gold, limit ₹3,00,000, covers Appendectomy, Angioplasty, Knee replacement
- Contracts: InsureTrust `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`, ClaimVerifier `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, TestINR `0x5FbDB2315678afecb367f032d93F642f64180aa3`
