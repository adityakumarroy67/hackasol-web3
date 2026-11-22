import assert from "node:assert/strict";
import test from "node:test";
import { reviewClaimAmount } from "./review-claim-amount.js";

test("the hospital requests the approved ₹1,000", () => {
  assert.deepEqual(reviewClaimAmount(100_000n, 100_000n), {
    status: "amount-matched", differencePaise: 0n,
  });
});

test("a ₹1,100 request exceeds approval by ₹100", () => {
  assert.deepEqual(reviewClaimAmount(100_000n, 110_000n), {
    status: "amount-mismatch", differencePaise: 10_000n,
  });
});

test("a reduced request still differs from the approved bill", () => {
  assert.deepEqual(reviewClaimAmount(100_000n, 90_000n), {
    status: "amount-mismatch", differencePaise: -10_000n,
  });
});

test("a request without an approval remains pending", () => {
  assert.deepEqual(reviewClaimAmount(null, 100_000n), {
    status: "awaiting-approval", differencePaise: null,
  });
});

test("amounts must be exact positive uint64 values", () => {
  for (const invalid of [0n, -1n, 1n << 64n, 1000.5, "100000", undefined]) {
    assert.throws(() => reviewClaimAmount(invalid, 100_000n), RangeError);
    assert.throws(() => reviewClaimAmount(null, invalid), RangeError);
  }
  const maximum = (1n << 64n) - 1n;
  assert.equal(reviewClaimAmount(maximum, maximum).differencePaise, 0n);
});
