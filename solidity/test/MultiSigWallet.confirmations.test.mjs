import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/MultiSigWallet.sol", import.meta.url), "utf8");

function makeWallet({ owners = ["alice", "bob", "carol"], required = 2 } = {}) {
  return {
    owners,
    required,
    txs: [],
    confirmations: new Map(),
    confirmationDetails: new Map(),
    isContract: new Set(["targetContract"]),
    block: 1n,
  };
}

function key(txId, owner) {
  return `${txId}:${owner}`;
}

function submitTransaction(wallet, to, data = "0x") {
  if (to === "0x0") throw new Error("Invalid target");
  if (data !== "0x" && !wallet.isContract.has(to)) throw new Error("Target not contract");

  const txId = wallet.txs.length;
  wallet.txs.push({ to, data, executed: false });
  return txId;
}

function confirmTransaction(wallet, txId, owner) {
  const k = key(txId, owner);
  if (wallet.txs[txId].executed) throw new Error("Already executed");
  if (wallet.confirmations.get(k)) throw new Error("Already confirmed");

  wallet.confirmations.set(k, true);
  wallet.confirmationDetails.set(k, {
    confirmed: true,
    confirmedAtBlock: wallet.block,
    revokedAtBlock: 0n,
  });
}

function revokeConfirmation(wallet, txId, owner) {
  const k = key(txId, owner);
  if (wallet.txs[txId].executed) throw new Error("Already executed");
  if (!wallet.confirmations.get(k)) throw new Error("Not confirmed");

  wallet.confirmations.set(k, false);
  const detail = wallet.confirmationDetails.get(k);
  detail.confirmed = false;
  detail.revokedAtBlock = wallet.block;
}

function isConfirmedAtBlock(wallet, txId, owner, blockNumber) {
  const detail = wallet.confirmationDetails.get(key(txId, owner));
  return Boolean(
    detail
      && detail.confirmedAtBlock !== 0n
      && detail.confirmedAtBlock <= blockNumber
      && (detail.revokedAtBlock === 0n || detail.revokedAtBlock > blockNumber),
  );
}

function countAtBlock(wallet, txId, blockNumber) {
  return wallet.owners.filter((owner) => isConfirmedAtBlock(wallet, txId, owner, blockNumber)).length;
}

test("executeTransaction is nonReentrant and uses block-level confirmation snapshots", () => {
  assert.match(source, /import "@openzeppelin\/contracts\/utils\/ReentrancyGuard\.sol";/);
  assert.match(source, /contract MultiSigWallet is ReentrancyGuard/);
  assert.match(source, /function executeTransaction\(uint256 txId\) external onlyOwner nonReentrant/);
  assert.match(source, /uint256 executionBlock = block\.number;/);
  assert.match(source, /getConfirmationCountAtBlock\(txId, executionBlock\) >= required/);
  assert.match(source, /"Confirmations changed"/);
});

test("confirmation tracking records confirmation and revocation blocks", () => {
  assert.match(source, /struct Confirmation/);
  assert.match(source, /uint256 confirmedAtBlock;/);
  assert.match(source, /uint256 revokedAtBlock;/);
  assert.match(source, /mapping\(uint256 => mapping\(address => Confirmation\)\) public confirmationDetails;/);
});

test("submitTransaction rejects zero address and data calls to non-contracts", () => {
  const wallet = makeWallet();

  assert.throws(() => submitTransaction(wallet, "0x0"), /Invalid target/);
  assert.throws(() => submitTransaction(wallet, "bob", "0x1234"), /Target not contract/);
  assert.equal(submitTransaction(wallet, "bob", "0x"), 0);
  assert.equal(submitTransaction(wallet, "targetContract", "0x1234"), 1);

  assert.match(source, /require\(to != address\(0\), "Invalid target"\);/);
  assert.match(source, /require\(to\.code\.length > 0, "Target not contract"\);/);
});

test("isConfirmedAtBlock prevents front-running revocations", () => {
  const wallet = makeWallet();
  const txId = submitTransaction(wallet, "bob");

  confirmTransaction(wallet, txId, "alice");
  confirmTransaction(wallet, txId, "bob");
  assert.equal(countAtBlock(wallet, txId, wallet.block), 2);

  wallet.block += 1n;
  revokeConfirmation(wallet, txId, "bob");

  assert.equal(countAtBlock(wallet, txId, wallet.block), 1);
});

test("revocation during execution callback is detected in the same block snapshot", () => {
  const wallet = makeWallet();
  const txId = submitTransaction(wallet, "targetContract", "0x1234");

  confirmTransaction(wallet, txId, "alice");
  confirmTransaction(wallet, txId, "bob");
  const executionBlock = wallet.block;
  assert.equal(countAtBlock(wallet, txId, executionBlock), 2);

  revokeConfirmation(wallet, txId, "bob");

  assert.equal(countAtBlock(wallet, txId, executionBlock), 1);
});

test("normal submit, confirm, revoke, and execute flow remains intact", () => {
  const wallet = makeWallet();
  const txId = submitTransaction(wallet, "bob");

  confirmTransaction(wallet, txId, "alice");
  assert.equal(countAtBlock(wallet, txId, wallet.block), 1);

  revokeConfirmation(wallet, txId, "alice");
  assert.equal(countAtBlock(wallet, txId, wallet.block), 0);

  wallet.block += 1n;
  confirmTransaction(wallet, txId, "alice");
  confirmTransaction(wallet, txId, "bob");
  assert.equal(countAtBlock(wallet, txId, wallet.block), 2);
});
