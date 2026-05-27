import assert from "node:assert/strict";
import test from "node:test";

const BASIS_POINTS = 10_000n;

function amountOut({ reserveIn, reserveOut, amountIn, feeBps }) {
  const inputAfterFee = BigInt(amountIn) * (BASIS_POINTS - BigInt(feeBps));
  return (BigInt(reserveOut) * inputAfterFee) / (BigInt(reserveIn) * BASIS_POINTS + inputAfterFee);
}

function simulateSwap({ reserveIn, reserveOut, amountIn, feeBps, minAmountOut, now, deadline }) {
  if (BigInt(now) > BigInt(deadline)) {
    throw new Error("Transaction expired");
  }
  const output = amountOut({ reserveIn, reserveOut, amountIn, feeBps });
  if (output < BigInt(minAmountOut)) {
    throw new Error("Slippage exceeded");
  }
  return output;
}

test("swap succeeds when quoted output satisfies minAmountOut before deadline", () => {
  const quoted = amountOut({
    reserveIn: 10_000n,
    reserveOut: 20_000n,
    amountIn: 1_000n,
    feeBps: 30n,
  });

  assert.equal(quoted, 1_813n);
  assert.equal(
    simulateSwap({
      reserveIn: 10_000n,
      reserveOut: 20_000n,
      amountIn: 1_000n,
      feeBps: 30n,
      minAmountOut: quoted,
      now: 100n,
      deadline: 100n,
    }),
    quoted,
  );
});

test("swap rejects expired deadlines and excessive slippage", () => {
  assert.throws(
    () =>
      simulateSwap({
        reserveIn: 10_000n,
        reserveOut: 20_000n,
        amountIn: 1_000n,
        feeBps: 30n,
        minAmountOut: 1n,
        now: 101n,
        deadline: 100n,
      }),
    /Transaction expired/,
  );

  assert.throws(
    () =>
      simulateSwap({
        reserveIn: 10_000n,
        reserveOut: 20_000n,
        amountIn: 1_000n,
        feeBps: 30n,
        minAmountOut: 1_814n,
        now: 100n,
        deadline: 100n,
      }),
    /Slippage exceeded/,
  );
});

test("basis-point fee math keeps the fee inside the constant-product quote", () => {
  const oldPreTruncatedFee = 333n - (333n * 30n) / BASIS_POINTS;
  const oldOutput = (10_000n * oldPreTruncatedFee) / (5_000n + oldPreTruncatedFee);
  const newOutput = amountOut({
    reserveIn: 5_000n,
    reserveOut: 10_000n,
    amountIn: 333n,
    feeBps: 30n,
  });

  assert.equal(oldOutput, 624n);
  assert.equal(newOutput, 622n);
  assert.ok(oldOutput > newOutput);
  assert.notEqual(
    (333n * 30n) / BASIS_POINTS,
    333n * 30n,
    "fee calculation should not be represented as a pre-subtracted integer-only fee",
  );
});
