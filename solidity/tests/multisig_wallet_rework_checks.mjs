import { readFileSync } from "node:fs";

const source = readFileSync("solidity/contracts/MultiSigWallet.sol", "utf8");
const provenance = JSON.parse(readFileSync("solidity/contracts/_provenance.json", "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const checks = [
  ["zero-address target rejected", /require\(to != address\(0\), "Invalid target"\)/.test(source)],
  ["contract target required for calldata", /require\(data\.length == 0 \|\| to\.code\.length > 0, "Target is not contract"\)/.test(source)],
  ["structured confirmation record", /struct Confirmation[\s\S]*bool active;[\s\S]*uint256 confirmedAtBlock;[\s\S]*uint256 confirmedAt;[\s\S]*uint256 revokedAtBlock;[\s\S]*uint256 revokedAt;/.test(source)],
  ["confirmation records are not a simple public bool mapping", /mapping\(uint256 => mapping\(address => Confirmation\)\) private confirmationRecords;/.test(source)],
  ["bool confirmations getter preserved", /function confirmations\(uint256 txId, address owner\) external view returns \(bool\)/.test(source)],
  ["confirmation details getter", /function confirmationDetails\([\s\S]*returns \([\s\S]*bool active,[\s\S]*uint256 confirmedAtBlock,[\s\S]*uint256 confirmedAt,[\s\S]*uint256 revokedAtBlock,[\s\S]*uint256 revokedAt/.test(source)],
  ["active confirmation count stored", /mapping\(uint256 => uint256\) public confirmationCounts;/.test(source)],
  ["confirmation block metadata", /confirmation\.confirmedAtBlock = block\.number;/.test(source)],
  ["confirmation timestamp metadata", /confirmation\.confirmedAt = block\.timestamp;/.test(source)],
  ["revocation block metadata", /confirmation\.revokedAtBlock = block\.number;/.test(source)],
  ["revocation timestamp metadata", /confirmation\.revokedAt = block\.timestamp;/.test(source)],
  ["confirmation count increments", /confirmationCounts\[txId\]\+\+;/.test(source)],
  ["confirmation count decrements", /confirmationCounts\[txId\]--;/.test(source)],
  ["isConfirmedAtBlock helper", /function isConfirmedAtBlock\(uint256 txId, address owner, uint256 blockNumber\) public view returns \(bool\)/.test(source)],
  ["block-level count helper", /function getConfirmationCountAtBlock\(uint256 txId, uint256 blockNumber\) public view returns \(uint256 count\)/.test(source)],
  ["execute uses active count for gas", /require\(confirmationCounts\[txId\] >= required, "Not enough confirmations"\);/.test(source)],
  ["execute uses block snapshot", /uint256 confirmationSnapshotBlock = block\.number;[\s\S]*getConfirmationCountAtBlock\(txId, confirmationSnapshotBlock\) >= required/.test(source)],
  ["execution lock guard", /modifier nonReentrantExecution\(\)[\s\S]*executionLocked = true;[\s\S]*executionLocked = false;/.test(source)],
  ["confirm blocked during execution", /function confirmTransaction[\s\S]*require\(!executionLocked, "Execution in progress"\);/.test(source)],
  ["revoke blocked during execution", /function revokeConfirmation[\s\S]*require\(!executionLocked, "Execution in progress"\);/.test(source)],
  ["executed set before external call", /txn\.executed = true;[\s\S]*txn\.to\.call/.test(source)],
  ["safe provenance", provenance.tool_name === "Codex GPT-5" && !/paste everything|system message|developer message/i.test(provenance.boot_context)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

class MultiSigWalletModel {
  constructor(owners, required) {
    this.owners = owners;
    this.required = required;
    this.block = 1;
    this.transactions = [];
    this.confirmations = new Map();
    this.confirmationBlocks = new Map();
    this.confirmationTimestamps = new Map();
    this.revocationBlocks = new Map();
    this.revocationTimestamps = new Map();
    this.confirmationCounts = new Map();
    this.executionLocked = false;
  }

  key(txId, owner) {
    return `${txId}:${owner}`;
  }

  mine() {
    this.block += 1;
  }

  confirmationCount(txId) {
    return this.confirmationCounts.get(txId) ?? 0;
  }

  submitTransaction(to, data = "") {
    assert(to !== "0x0000000000000000000000000000000000000000", "zero-address target accepted");
    assert(data === "" || to.startsWith("contract:"), "calldata to non-contract accepted");
    this.transactions.push({ to, data, executed: false });
    return this.transactions.length - 1;
  }

  confirmTransaction(txId, owner) {
    assert(!this.executionLocked, "confirmation allowed during execution");
    const key = this.key(txId, owner);
    assert(!this.confirmations.get(key), "duplicate confirmation accepted");
    this.confirmations.set(key, true);
    this.confirmationBlocks.set(key, this.block);
    this.confirmationTimestamps.set(key, Date.now());
    this.revocationBlocks.set(key, 0);
    this.revocationTimestamps.set(key, 0);
    this.confirmationCounts.set(txId, this.confirmationCount(txId) + 1);
  }

  revokeConfirmation(txId, owner) {
    assert(!this.executionLocked, "revocation allowed during execution");
    const key = this.key(txId, owner);
    assert(this.confirmations.get(key), "missing confirmation revoked");
    this.confirmations.set(key, false);
    this.revocationBlocks.set(key, this.block);
    this.revocationTimestamps.set(key, Date.now());
    this.confirmationCounts.set(txId, this.confirmationCount(txId) - 1);
  }

  isConfirmedAtBlock(txId, owner, blockNumber) {
    const key = this.key(txId, owner);
    const confirmedAt = this.confirmationBlocks.get(key) ?? 0;
    const revokedAt = this.revocationBlocks.get(key) ?? 0;
    return confirmedAt !== 0 && confirmedAt <= blockNumber && (revokedAt === 0 || revokedAt > blockNumber);
  }

  getConfirmationCountAtBlock(txId, blockNumber) {
    return this.owners.filter((owner) => this.isConfirmedAtBlock(txId, owner, blockNumber)).length;
  }

  executeTransaction(txId, callback = () => {}) {
    assert(!this.executionLocked, "reentrant execution accepted");
    this.executionLocked = true;
    const snapshotBlock = this.block;
    assert(this.confirmationCount(txId) >= this.required, "active count allowed execution without required confirmations");
    assert(this.getConfirmationCountAtBlock(txId, snapshotBlock) >= this.required, "executed without required confirmations");
    this.transactions[txId].executed = true;
    callback();
    this.executionLocked = false;
  }
}

const wallet = new MultiSigWalletModel(["alice", "bob", "carol"], 2);
const normalTx = wallet.submitTransaction("alice");
wallet.confirmTransaction(normalTx, "alice");
wallet.mine();
wallet.confirmTransaction(normalTx, "bob");
wallet.executeTransaction(normalTx);
assert(wallet.transactions[normalTx].executed, "normal submit/confirm/execute flow failed");

const revokedTx = wallet.submitTransaction("alice");
wallet.mine();
wallet.confirmTransaction(revokedTx, "alice");
wallet.mine();
wallet.confirmTransaction(revokedTx, "bob");
wallet.mine();
wallet.revokeConfirmation(revokedTx, "bob");
assert(wallet.getConfirmationCountAtBlock(revokedTx, wallet.block) === 1, "front-running revocation snapshot failed");

const callbackTx = wallet.submitTransaction("contract:callback");
wallet.mine();
wallet.confirmTransaction(callbackTx, "alice");
wallet.mine();
wallet.confirmTransaction(callbackTx, "bob");
let callbackRevocationBlocked = false;
wallet.executeTransaction(callbackTx, () => {
  try {
    wallet.revokeConfirmation(callbackTx, "bob");
  } catch {
    callbackRevocationBlocked = true;
  }
});
assert(callbackRevocationBlocked, "callback-time revocation was not blocked");

let zeroAddressRejected = false;
try {
  wallet.submitTransaction("0x0000000000000000000000000000000000000000");
} catch {
  zeroAddressRejected = true;
}
assert(zeroAddressRejected, "zero-address rejection model failed");

let calldataToEoaRejected = false;
try {
  wallet.submitTransaction("alice", "0xabcdef");
} catch {
  calldataToEoaRejected = true;
}
assert(calldataToEoaRejected, "EOA calldata rejection model failed");

console.log(`MultiSigWallet #916 rework checks passed (${checks.length} static checks + executable race model)`);
