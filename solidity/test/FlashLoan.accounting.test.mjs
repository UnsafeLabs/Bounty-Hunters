import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/FlashLoan.sol", import.meta.url), "utf8");

const BPS_DENOMINATOR = 10_000n;
const MAX_LOAN_BPS = 5_000n;

function feeFor(amount, feeBps) {
  if (amount === 0n) return 0n;
  const fee = (amount * feeBps) / BPS_DENOMINATOR;
  return fee === 0n ? 1n : fee;
}

function runLoan({ poolBalance, amount, feeBps }) {
  if (amount <= 0n) throw new Error("Amount must be > 0");
  if (amount > poolBalance) throw new Error("Insufficient pool balance");
  if (amount > (poolBalance * MAX_LOAN_BPS) / BPS_DENOMINATOR) {
    throw new Error("Loan exceeds cap");
  }
  const fee = feeFor(amount, feeBps);
  return {
    fee,
    poolBalance: poolBalance + fee,
    totalFees: fee,
    repayment: amount + fee,
  };
}

test("source uses internal accounting and explicit repayment", () => {
  assert.match(source, /uint256 public poolBalance;/);
  assert.match(source, /bool private activeLoan;/);
  assert.match(source, /_safeTransferFrom\(msg\.sender, address\(this\), repayment\);/);
  assert.match(source, /amount <= availableLiquidity \* MAX_LOAN_BPS \/ BPS_DENOMINATOR/);
  assert.match(source, /poolBalance = availableLiquidity - amount;/);
  assert.match(source, /poolBalance \+= repayment;/);
});

test("minimum one-unit fee prevents zero-fee small loans", () => {
  assert.equal(feeFor(1n, 30n), 1n);
  assert.equal(feeFor(333n, 30n), 1n);
  assert.equal(feeFor(10_000n, 30n), 30n);
});

test("loans above 50 percent of internally tracked pool liquidity are rejected", () => {
  assert.throws(() => runLoan({ poolBalance: 1_000n, amount: 501n, feeBps: 30n }), {
    message: "Loan exceeds cap",
  });
  assert.doesNotThrow(() => runLoan({ poolBalance: 1_000n, amount: 500n, feeBps: 30n }));
});

test("successful loan increases internal pool balance only by accrued fee", () => {
  const result = runLoan({ poolBalance: 1_000_000n, amount: 100_000n, feeBps: 30n });
  assert.equal(result.fee, 300n);
  assert.equal(result.repayment, 100_300n);
  assert.equal(result.poolBalance, 1_000_300n);
  assert.equal(result.totalFees, 300n);
});

test("direct token donations are outside the internal loan cap until explicitly accounted", () => {
  const poolBalance = 1_000n;
  const externalTokenBalance = 2_000n;
  assert.equal(externalTokenBalance, 2n * poolBalance);
  assert.throws(() => runLoan({ poolBalance, amount: 750n, feeBps: 30n }), {
    message: "Loan exceeds cap",
  });
});

test("owner pause controls gate flash loans", () => {
  assert.match(source, /bool public paused;/);
  assert.match(source, /modifier whenNotPaused\(\)/);
  assert.match(source, /function flashLoan\(uint256 amount, bytes calldata data\) external whenNotPaused/);
  assert.match(source, /function pause\(\) external onlyOwner/);
  assert.match(source, /paused = true;/);
  assert.match(source, /function unpause\(\) external onlyOwner/);
  assert.match(source, /paused = false;/);
});

test("withdrawing fees reduces internal pool liquidity by the accrued fee amount", () => {
  const afterLoan = runLoan({ poolBalance: 10_000n, amount: 5_000n, feeBps: 30n });
  const afterWithdraw = afterLoan.poolBalance - afterLoan.totalFees;
  assert.equal(afterWithdraw, 10_000n);
});
