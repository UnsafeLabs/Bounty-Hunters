import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/FlashLoan.sol", import.meta.url), "utf8");

class FlashLoanModel {
  constructor(feeBPS) {
    this.feeBPS = BigInt(feeBPS);
    this.poolBalance = 0n;
    this.totalFees = 0n;
    this.paused = false;
    this.externalTokenBalance = 0n;
  }

  calculateFee(amount) {
    amount = BigInt(amount);
    const fee = (amount * this.feeBPS) / 10_000n;
    return fee === 0n && amount > 0n ? 1n : fee;
  }

  deposit(amount) {
    amount = BigInt(amount);
    this.poolBalance += amount;
    this.externalTokenBalance += amount;
  }

  flashLoan(amount, repayAmount, { externalBalanceDelta = 0n } = {}) {
    amount = BigInt(amount);
    repayAmount = BigInt(repayAmount);
    externalBalanceDelta = BigInt(externalBalanceDelta);
    const snapshot = {
      poolBalance: this.poolBalance,
      totalFees: this.totalFees,
      externalTokenBalance: this.externalTokenBalance,
    };

    try {
      assert.equal(this.paused, false, "Paused");
      assert(amount > 0n, "Amount must be > 0");
      assert(this.poolBalance >= amount, "Insufficient pool balance");
      assert(amount <= (this.poolBalance * 5_000n) / 10_000n, "Loan cap exceeded");

      const fee = this.calculateFee(amount);
      const repayment = amount + fee;

      this.poolBalance -= amount;
      this.externalTokenBalance -= amount;

      this.externalTokenBalance += externalBalanceDelta;
      assert(repayAmount >= repayment, "Loan not repaid");

      this.externalTokenBalance += repayment;
      this.poolBalance += repayment;
      this.totalFees += fee;
      return fee;
    } catch (error) {
      this.poolBalance = snapshot.poolBalance;
      this.totalFees = snapshot.totalFees;
      this.externalTokenBalance = snapshot.externalTokenBalance;
      throw error;
    }
  }

  withdrawFees() {
    const fees = this.totalFees;
    assert(fees > 0n, "No fees");
    this.totalFees = 0n;
    this.poolBalance -= fees;
    this.externalTokenBalance -= fees;
    return fees;
  }
}

test("source uses internal accounting and explicit repayment instead of balanceOf repayment checks", () => {
  assert.match(source, /uint256 public poolBalance;/);
  assert.match(source, /poolBalance -= amount;/);
  assert.match(source, /poolBalance \+= repayment;/);
  assert.match(
    source,
    /loanToken\.transferFrom\(msg\.sender,\s*address\(this\),\s*repayment\)/
  );
  assert.doesNotMatch(source, /balanceAfter\s*>=\s*balanceBefore\s*\+\s*fee/);
});

test("minimum one-unit fee prevents zero-fee small loans", () => {
  const loan = new FlashLoanModel(30);

  assert.equal(loan.calculateFee(1), 1n);
  assert.equal(loan.calculateFee(333), 1n);
  assert.equal(loan.calculateFee(10_000), 30n);
});

test("loans above 50 percent of internally tracked liquidity are rejected", () => {
  const loan = new FlashLoanModel(30);
  loan.deposit(1_000n);

  assert.throws(() => loan.flashLoan(501n, 503n), /Loan cap exceeded/);
  assert.equal(loan.flashLoan(500n, 502n), 1n);
});

test("external balance manipulation cannot satisfy repayment", () => {
  const loan = new FlashLoanModel(30);
  loan.deposit(1_000n);

  assert.throws(
    () => loan.flashLoan(100n, 100n, { externalBalanceDelta: 1_000n }),
    /Loan not repaid/
  );
  assert.equal(loan.poolBalance, 1_000n);
  assert.equal(loan.externalTokenBalance, 1_000n);
});

test("fee accrual and withdrawal update internal pool accounting", () => {
  const loan = new FlashLoanModel(30);
  loan.deposit(1_000n);

  const fee = loan.flashLoan(100n, 101n);
  assert.equal(fee, 1n);
  assert.equal(loan.poolBalance, 1_001n);
  assert.equal(loan.totalFees, 1n);

  assert.equal(loan.withdrawFees(), 1n);
  assert.equal(loan.poolBalance, 1_000n);
  assert.equal(loan.totalFees, 0n);
});

test("pause and unpause controls block and restore flash loans", () => {
  const loan = new FlashLoanModel(30);
  loan.deposit(1_000n);
  loan.paused = true;

  assert.throws(() => loan.flashLoan(100n, 101n), /Paused/);

  loan.paused = false;
  assert.equal(loan.flashLoan(100n, 101n), 1n);
});

test("source exposes owner pause and unpause controls plus a reentrancy guard", () => {
  assert.match(source, /function pause\(\) external onlyOwner/);
  assert.match(source, /function unpause\(\) external onlyOwner/);
  assert.match(source, /modifier nonReentrant\(\)/);
  assert.match(source, /require\(!loanActive, "Loan active"\)/);
});
