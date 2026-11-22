# Claim Rules — Draft

This describes the intended checks. Development uses made-up records and local test funds only.

## Public information

- Claim amount
- Policy commitment
- One-use claim code (nullifier)
- Approved-hospital list fingerprint (Merkle root)
- `hospitalPayoutAddress` — the hospital's public blockchain address that receives an approved claim payment
- `claimSubmissionTime` — UTC Unix seconds; the contract checks it is not later than the current block time
- `chainId` and `verifyingContract` — public deployment values checked against the current chain and settlement contract

## Private information

- Diagnosis and procedure
- Prescriptions and treatment history
- Medical record contents
- UTC Unix-second claim date, policy limit, expiry date, and covered-procedure list

## What the proof must establish

1. The hospital is on the approved list.
   - The proof-signing key and `hospitalPayoutAddress` must be linked to the same approved-hospital list entry.
2. The private policy terms open `policyCommitment`; the settlement contract confirms the insurer registered that commitment.
3. The policy is active on the claim date.
4. The procedure is covered by that policy.
5. The claim amount is within the policy limit.

The contract must reject a nullifier that has already been used.

## Important trust rule

A proof shows that the supplied information follows these rules. It does not prove by itself that the hospital’s information is true. The circuit draft verifies a hospital signature. The settlement contract must confirm that the insurer registered the policy commitment.

## Data handling

Keep records encrypted and off the blockchain. Do not use real patient records during development. Blockchain permissions cannot erase a record someone has already downloaded.

## Decisions still open

- Country where the first hospitals and insurers will operate
- Real payment asset and arrangements; local work uses a mock tINR token with 2 decimal places (paise units)
- How hospital credentials and insurer policies will be authenticated in a real deployment
- How insurer-issued claim identifiers will be authenticated to detect duplicate services submitted under new identifiers
## Where claim facts come from

A zero-knowledge proof can show that the supplied facts follow the policy rules. It cannot, by itself, prove those facts came from a real hospital.

- The hospital must digitally sign the claim facts. A digital signature is an electronic stamp that identifies who issued the information and shows it has not been changed.
- The settlement contract must confirm that the insurer registered the policy commitment.
- The proof must connect those authenticated facts to the claim amount and private treatment details.

The current circuit draft uses CircomLib EdDSA-Poseidon for the hospital signature. The signing service, hospital key onboarding and rotation, and independent security review are not yet implemented or validated.

## Proof inputs — draft

### Public

- `claimAmount`
- `policyCommitment`
- `claimNullifier` — `Poseidon(1003, policyId, claimId, policySalt)`; the contract records it to block replay of the same claim ID under the same policy.
- `approvedHospitalRoot` — the public fingerprint of the approved-hospital list
- `hospitalPayoutAddress` — the approved hospital's public address that receives the payment
- `claimSubmissionTime` — a public timestamp the contract checks against the current block time; the proof shows the private claim date is not later than this time
- `chainId` and `verifyingContract` — public deployment identifiers bound into the hospital signature; the contract checks they match its current chain and address

### Private
policyStartDate ≤ claimDate < policyExpiryDate
- Procedure code and claim date
- Policy identifier and stable claim identifier used to derive the nullifier
- The proof must show that the private policy dates, limit, and covered procedures match the terms
represented by the public policyCommitment
- The insurer must create or approve the policyCommitment from the policy terms and confirm that it belongs to an active policy.
- Policy expiry date, limit, and covered-procedure information
- Hospital details and its proof of membership in the approved list
- Policy details and the secret value used to create its commitment and nullifier
- Information needed to check the hospital's claim signature

The diagnosis, prescriptions, treatment history, and full record should stay encrypted off-chain. Include them in the proof only if a specific rule requires them.

### Open design points

- The policy commitment must not reveal a patient identity or make claims easy to link together.
- The nullifier must be derived so the same claim always gets the same value; the current draft uses the stable claim ID and policy salt.
- The policy salt must be generated with a cryptographically secure random source and at least 128 bits of entropy; the circuit cannot check how it was generated.
- The system must establish that a private claim date is not in the future without revealing the exact date.
- The current circuit draft uses CircomLib EdDSA-Poseidon for the hospital signature; real key onboarding and independent security review remain open.
- The claim identifier must be stable for the same underlying claim. A different identifier creates a different nullifier. The current circuit does not prove who issued that identifier, so insurer-issued reference authentication is still required to detect duplicate services submitted under new identifiers.
- The circuit uses 128-bit unsigned amounts and limits in the payout token's smallest unit. The local mock tINR uses 2 decimal places; the real payment asset and unit remain open.
- The circuit uses UTC Unix seconds for claim, policy, and submission times. The contract must compare the public submission time with `block.timestamp`.
- Policy registration in an insurer-controlled settlement registry is the draft authorization method. The contract implementing this registry remains to be built.
