import assert from "node:assert/strict";

const BPS_DENOMINATOR = 10_000n;
const MAX_LOAN_BPS = 5_000n;

class FlashLoanModel {
  constructor(feeBPS) {
    this.feeBPS = feeBPS;
    this.totalFees = 0n;
    this.poolBalance = 0n;
    this.paused = false;
    this.loanInProgress = false;
  }

  deposit(amount) {
    if (amount <= 0n) throw new Error("Amount must be > 0");
    this.poolBalance += amount;
  }

  maxLoanAmount() {
    return (this.poolBalance * MAX_LOAN_BPS) / BPS_DENOMINATOR;
  }

  flashFee(amount) {
    const fee = (amount * this.feeBPS) / BPS_DENOMINATOR;
    return fee === 0n ? 1n : fee;
  }

  flashLoan(amount, repayAmount) {
    if (this.paused) throw new Error("Paused");
    if (this.loanInProgress) throw new Error("Loan in progress");
    if (amount <= 0n) throw new Error("Amount must be > 0");
    if (amount > this.maxLoanAmount()) throw new Error("Loan exceeds cap");
    if (this.poolBalance < amount) throw new Error("Insufficient pool balance");

    const fee = this.flashFee(amount);
    const poolBefore = this.poolBalance;
    this.loanInProgress = true;
    this.poolBalance -= amount;

    if (repayAmount < amount + fee) {
      this.poolBalance = poolBefore;
      this.loanInProgress = false;
      throw new Error("Repayment failed");
    }

    this.poolBalance += amount + fee;
    this.totalFees += fee;
    this.loanInProgress = false;
    return fee;
  }

  pause() {
    this.paused = true;
  }

  unpause() {
    this.paused = false;
  }

  withdrawFees() {
    const fees = this.totalFees;
    if (fees <= 0n) throw new Error("No fees");
    this.totalFees = 0n;
    this.poolBalance -= fees;
    return fees;
  }
}

{
  const model = new FlashLoanModel(30n);
  model.deposit(10_000n);

  assert.equal(model.flashFee(1n), 1n);
  assert.equal(model.flashLoan(1n, 2n), 1n);
  assert.equal(model.totalFees, 1n);
}

{
  const model = new FlashLoanModel(30n);
  model.deposit(10_000n);

  assert.equal(model.maxLoanAmount(), 5_000n);
  assert.throws(() => model.flashLoan(5_001n, 5_003n), /Loan exceeds cap/);
}

{
  const model = new FlashLoanModel(30n);
  model.deposit(10_000n);

  assert.throws(() => model.flashLoan(1_000n, 1_000n), /Repayment failed/);
  assert.equal(model.poolBalance, 10_000n);
  assert.equal(model.totalFees, 0n);
}

{
  const model = new FlashLoanModel(30n);
  model.deposit(10_000n);
  model.pause();
  assert.throws(() => model.flashLoan(1_000n, 1_001n), /Paused/);
  model.unpause();
  assert.equal(model.flashLoan(1_000n, 1_003n), 3n);
}

{
  const model = new FlashLoanModel(30n);
  model.deposit(10_000n);
  model.flashLoan(1_000n, 1_003n);

  assert.equal(model.totalFees, 3n);
  assert.equal(model.poolBalance, 10_003n);
  assert.equal(model.withdrawFees(), 3n);
  assert.equal(model.poolBalance, 10_000n);
}

console.log("FlashLoan fee, cap, pause, and accounting checks passed");
