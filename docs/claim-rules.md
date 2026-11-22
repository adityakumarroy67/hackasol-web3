# Claim Rules — Draft

This describes the intended checks. Development uses made-up records and local test funds only.

## Public information

- Claim amount
- Policy commitment
- One-use claim code (nullifier)
- Approved-hospital list fingerprint (Merkle root)

## Private information

- Diagnosis and procedure
- Prescriptions and treatment history
- Medical record contents
- Claim date, policy limit, expiry date, and covered-procedure list

## What the proof must establish

1. The hospital is on the approved list.
2. The policy is authorized by the insurer.
3. The policy is active on the claim date.
4. The procedure is covered by that policy.
5. The claim amount is within the policy limit.

The contract must reject a nullifier that has already been used.

## Important trust rule

A proof shows that the supplied information follows these rules. It does not prove by itself that the hospital’s information is true. The hospital must authenticate the claim, and the insurer must authenticate the policy. The exact method still needs design.

## Data handling

Keep records encrypted and off the blockchain. Do not use real patient records during development. Blockchain permissions cannot erase a record someone has already downloaded.

## Decisions still open

- Country where the first hospitals and insurers will operate
- How real payments will be made
- How hospital credentials and insurer policies will be authenticated
## Where claim facts come from

A zero-knowledge proof can show that the supplied facts follow the policy rules. It cannot, by itself, prove those facts came from a real hospital.

- The hospital must digitally sign the claim facts. A digital signature is an electronic stamp that identifies who issued the information and shows it has not been changed.
- The insurer must confirm that the policy commitment represents policy terms it authorized.
- The proof must connect those authenticated facts to the claim amount and private treatment details.

The exact signature method still needs research and design; this requirement is not yet implemented or validated.

## Proof inputs — draft

### Public

- `claimAmount`
- `policyCommitment`
- `claimNullifier` — a one-use code the proof derives for this claim
- `approvedHospitalRoot` — the public fingerprint of the approved-hospital list

### Private
policyStartDate ≤ claimDate < policyExpiryDate
- Procedure code and claim date
- The proof must show that the private policy dates, limit, and covered procedures match the terms
represented by the public policyCommitment
- The insurer must create or approve the policyCommitment from the policy terms and confirm that it belongs to an active policy.
- Policy expiry date, limit, and covered-procedure information
- Hospital details and its proof of membership in the approved list
- Policy details and the secret value used to create its commitment
- Information needed to check the hospital's claim signature and the insurer's policy approval; exact method still undecided

The diagnosis, prescriptions, treatment history, and full record should stay encrypted off-chain. Include them in the proof only if a specific rule requires them.

### Open design points

- The policy commitment must not reveal a patient identity or make claims easy to link together.
- The nullifier must be derived so the same claim always gets the same value.
- The signature method and exact input encoding are not selected yet.