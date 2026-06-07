import assert from "node:assert/strict";

const BPS_DENOMINATOR = 10_000n;

function originalQuote(amountIn, reserveIn, reserveOut, fee) {
  const feeAmount = (amountIn * fee) / BPS_DENOMINATOR;
  const amountInAfterFee = amountIn - feeAmount;
  return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
}

function fixedQuote(amountIn, reserveIn, reserveOut, fee) {
  const amountInWithFee = amountIn * (BPS_DENOMINATOR - fee);
  return (reserveOut * amountInWithFee) / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
}

function swap({ now, deadline, amountIn, minAmountOut, reserveIn, reserveOut, fee }) {
  if (now > deadline) throw new Error("Transaction expired");
  if (amountIn <= 0n) throw new Error("Amount must be > 0");

  const amountOut = fixedQuote(amountIn, reserveIn, reserveOut, fee);
  if (amountOut < minAmountOut) throw new Error("Slippage exceeded");

  return {
    amountOut,
    reserveIn: reserveIn + amountIn,
    reserveOut: reserveOut - amountOut,
  };
}

{
  const reserveIn = 1_000_000n;
  const reserveOut = 2_000_000n;
  const fee = 30n;
  const amountIn = 250_000n;
  const expected = fixedQuote(amountIn, reserveIn, reserveOut, fee);

  const result = swap({
    now: 100n,
    deadline: 100n,
    amountIn,
    minAmountOut: expected,
    reserveIn,
    reserveOut,
    fee,
  });

  assert.equal(result.amountOut, expected);
}

assert.throws(
  () =>
    swap({
      now: 100n,
      deadline: 100n,
      amountIn: 250_000n,
      minAmountOut: fixedQuote(250_000n, 1_000_000n, 2_000_000n, 30n) + 1n,
      reserveIn: 1_000_000n,
      reserveOut: 2_000_000n,
      fee: 30n,
    }),
  /Slippage exceeded/,
);

assert.throws(
  () =>
    swap({
      now: 101n,
      deadline: 100n,
      amountIn: 250_000n,
      minAmountOut: 0n,
      reserveIn: 1_000_000n,
      reserveOut: 2_000_000n,
      fee: 30n,
    }),
  /Transaction expired/,
);

{
  const amountIn = 100n;
  const reserveIn = 1_000n;
  const reserveOut = 1_000_000n;
  const fee = 30n;

  assert.notEqual(originalQuote(amountIn, reserveIn, reserveOut, fee), fixedQuote(amountIn, reserveIn, reserveOut, fee));
  assert.equal(fixedQuote(amountIn, reserveIn, reserveOut, fee), 90_661n);
}

console.log("SimpleSwap slippage and fee precision checks passed");
