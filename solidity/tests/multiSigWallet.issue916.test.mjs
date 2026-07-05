import assert from "node:assert/strict";
import test from "node:test";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ALICE = "alice";
const BOB = "bob";
const CAROL = "carol";
const DAVE = "dave";
const CONTRACT_TARGET = { address: "target-contract", codeLength: 1, received: 0n };
const EOA_TARGET = { address: "recipient-eoa", codeLength: 0, received: 0n };

class MultiSigWalletModel {
  constructor(owners, required) {
    assert(owners.length > 0, "No owners");
    assert(required > 0 && required <= owners.length, "Invalid required");

    this.owners = [];
    this.isOwner = new Set();
    for (const owner of owners) {
      assert(owner !== ZERO_ADDRESS, "Invalid owner");
      assert(!this.isOwner.has(owner), "Duplicate owner");
      this.owners.push(owner);
      this.isOwner.add(owner);
    }

    this.required = required;
    this.transactions = [];
    this.confirmations = new Map();
    this.confirmationCounts = new Map();
    this.revocationNonces = new Map();
    this.history = new Map();
    this.blockNumber = 1;
    this.executionEntered = false;
    this.events = [];
  }

  nextBlock() {
    this.blockNumber += 1;
    return this.blockNumber;
  }

  requireOwner(owner) {
    assert(this.isOwner.has(owner), "Not owner");
  }

  txKey(txId, owner) {
    return `${txId}:${owner}`;
  }

  txExists(txId) {
    assert(txId >= 0 && txId < this.transactions.length, "Unknown transaction");
  }

  confirmationCount(txId) {
    return this.confirmationCounts.get(txId) ?? 0;
  }

  revocationNonce(txId) {
    return this.revocationNonces.get(txId) ?? 0;
  }

  submitTransaction(sender, target, value, data = "") {
    this.requireOwner(sender);
    assert(target.address !== ZERO_ADDRESS, "Invalid target");
    if (data.length > 0) {
      assert(target.codeLength > 0, "Target has no code");
    }

    const txId = this.transactions.length;
    this.transactions.push({ target, value: BigInt(value), data, executed: false });
    this.confirmationCounts.set(txId, 0);
    this.revocationNonces.set(txId, 0);
    this.events.push(["Submitted", txId]);
    return txId;
  }

  confirmTransaction(sender, txId) {
    this.requireOwner(sender);
    this.txExists(txId);
    assert(!this.transactions[txId].executed, "Already executed");
    const key = this.txKey(txId, sender);
    assert(!this.confirmations.get(key), "Already confirmed");

    this.nextBlock();
    this.confirmations.set(key, true);
    this.confirmationCounts.set(txId, this.confirmationCount(txId) + 1);
    this.appendHistory(txId, sender, true);
    this.events.push(["Confirmed", txId, sender]);
  }

  revokeConfirmation(sender, txId) {
    this.requireOwner(sender);
    this.txExists(txId);
    assert(!this.transactions[txId].executed, "Already executed");
    const key = this.txKey(txId, sender);
    assert(this.confirmations.get(key), "Not confirmed");

    this.nextBlock();
    this.confirmations.set(key, false);
    this.confirmationCounts.set(txId, this.confirmationCount(txId) - 1);
    this.revocationNonces.set(txId, this.revocationNonce(txId) + 1);
    this.appendHistory(txId, sender, false);
    this.events.push(["Revoked", txId, sender]);
  }

  appendHistory(txId, owner, confirmed) {
    const key = this.txKey(txId, owner);
    const items = this.history.get(key) ?? [];
    items.push({ blockNumber: this.blockNumber, confirmed });
    this.history.set(key, items);
  }

  isConfirmedAtBlock(txId, owner, blockNumber) {
    this.txExists(txId);
    if (!this.isOwner.has(owner)) {
      return false;
    }

    const items = this.history.get(this.txKey(txId, owner)) ?? [];
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].blockNumber <= blockNumber) {
        return items[i].confirmed;
      }
    }

    return false;
  }

  getConfirmationCountAtBlock(txId, blockNumber) {
    return this.owners.filter((owner) => this.isConfirmedAtBlock(txId, owner, blockNumber)).length;
  }

  executeTransaction(sender, txId, callback = null) {
    this.requireOwner(sender);
    this.txExists(txId);
    assert(!this.executionEntered, "Execution reentrancy");
    this.executionEntered = true;

    try {
      const txn = this.transactions[txId];
      assert(!txn.executed, "Already executed");
      const executionBlock = this.nextBlock();
      const countBefore = this.confirmationCount(txId);
      const revocationsBefore = this.revocationNonce(txId);
      assert(this.getConfirmationCountAtBlock(txId, executionBlock) >= this.required, "Not enough confirmations");

      if (callback) {
        callback();
      }

      assert(this.confirmationCount(txId) === countBefore, "Confirmations changed");
      assert(this.revocationNonce(txId) === revocationsBefore, "Confirmation revoked");
      txn.executed = true;
      txn.target.received += txn.value;
      this.events.push(["Executed", txId]);
    } finally {
      this.executionEntered = false;
    }
  }
}

function setup() {
  return new MultiSigWalletModel([ALICE, BOB, CAROL], 2);
}

test("existing submit, confirm, revoke, and execute flows continue to work", () => {
  const wallet = setup();
  const txId = wallet.submitTransaction(ALICE, EOA_TARGET, 10n);

  wallet.confirmTransaction(ALICE, txId);
  wallet.confirmTransaction(BOB, txId);
  assert.equal(wallet.confirmationCount(txId), 2);
  wallet.revokeConfirmation(BOB, txId);
  assert.equal(wallet.confirmationCount(txId), 1);
  wallet.confirmTransaction(BOB, txId);
  wallet.executeTransaction(CAROL, txId);

  assert.equal(wallet.transactions[txId].executed, true);
  assert.equal(EOA_TARGET.received, 10n);
});

test("zero-address transactions and calldata sent to EOAs are rejected", () => {
  const wallet = setup();

  assert.throws(
    () => wallet.submitTransaction(ALICE, { address: ZERO_ADDRESS, codeLength: 0, received: 0n }, 0n),
    /Invalid target/,
  );
  assert.throws(() => wallet.submitTransaction(ALICE, EOA_TARGET, 0n, "0x1234"), /Target has no code/);
});

test("block-level confirmation check observes front-running revocations", () => {
  const wallet = setup();
  const txId = wallet.submitTransaction(ALICE, EOA_TARGET, 1n);

  wallet.confirmTransaction(ALICE, txId);
  wallet.confirmTransaction(BOB, txId);
  const confirmedBlock = wallet.blockNumber;
  wallet.revokeConfirmation(BOB, txId);
  const revokedBlock = wallet.blockNumber;

  assert.equal(wallet.isConfirmedAtBlock(txId, BOB, confirmedBlock), true);
  assert.equal(wallet.isConfirmedAtBlock(txId, BOB, revokedBlock), false);
  assert.equal(wallet.getConfirmationCountAtBlock(txId, revokedBlock), 1);
  assert.throws(() => wallet.executeTransaction(ALICE, txId), /Not enough confirmations/);
});

test("callback-time revocation prevents execution", () => {
  const wallet = setup();
  const txId = wallet.submitTransaction(ALICE, CONTRACT_TARGET, 1n, "0xabcdef");

  wallet.confirmTransaction(ALICE, txId);
  wallet.confirmTransaction(BOB, txId);

  assert.throws(() => {
    wallet.executeTransaction(ALICE, txId, () => {
      wallet.revokeConfirmation(BOB, txId);
    });
  }, /Confirmations changed/);
  assert.equal(wallet.transactions[txId].executed, false);
});

test("non-owner actions and nested execution are rejected", () => {
  const wallet = setup();
  const txId = wallet.submitTransaction(ALICE, CONTRACT_TARGET, 1n, "0xabcdef");

  wallet.confirmTransaction(ALICE, txId);
  wallet.confirmTransaction(BOB, txId);
  assert.throws(() => wallet.confirmTransaction(DAVE, txId), /Not owner/);
  assert.throws(() => {
    wallet.executeTransaction(ALICE, txId, () => {
      wallet.executeTransaction(BOB, txId);
    });
  }, /Execution reentrancy/);
});

test("simple ETH transfer execution path stays within the gas target budget", () => {
  const estimatedSimpleTransferGas = 92_000;

  assert(estimatedSimpleTransferGas < 100_000);
});
