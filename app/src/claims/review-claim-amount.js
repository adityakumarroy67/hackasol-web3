const MAX_PAISE = (1n << 64n) - 1n;

function validateAmount(paise) {
  if (typeof paise !== "bigint" || paise <= 0n || paise > MAX_PAISE) {
    throw new RangeError("Claim amounts must be positive uint64 values in paise");
  }
}

// An exact amount match is one prerequisite for settlement.
// Use null when the patient has not approved an invoice yet.
export function reviewClaimAmount(approvedPaise, requestedPaise) {
  validateAmount(requestedPaise);
  if (approvedPaise === null) {
    return { status: "awaiting-approval", differencePaise: null };
  }

  validateAmount(approvedPaise);
  const differencePaise = requestedPaise - approvedPaise;
  return {
    status: differencePaise === 0n ? "amount-matched" : "amount-mismatch",
    differencePaise,
  };
}
