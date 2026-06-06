import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "MultiSigWallet.sol");
const source = fs.readFileSync(sourcePath, "utf8");

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertMatches(pattern, message) {
  assert.match(source, pattern, message);
}

function assertBefore(first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} not found`);
  assert.notEqual(secondIndex, -1, `${second} not found`);
  assert.ok(firstIndex < secondIndex, message);
}

assertIncludes("struct Confirmation", "confirmations must carry block/timestamp metadata");
assertIncludes("uint256 confirmedAtBlock;", "confirmation block must be recorded");
assertIncludes("uint256 revokedAtBlock;", "revocation block must be recorded");
assertIncludes(
  "mapping(uint256 => mapping(address => Confirmation)) public confirmations;",
  "confirmation tracking must use metadata records instead of booleans",
);
assertIncludes(
  "mapping(uint256 => bool) public executionInProgress;",
  "executeTransaction must have a per-transaction execution guard",
);
assertMatches(
  /function isConfirmedAtBlock\([\s\S]*confirmedAtBlock[\s\S]*revokedAtBlock/,
  "block-level confirmation helper must account for confirmations and revocations",
);
assertMatches(
  /function getConfirmationCountAtBlock\([\s\S]*isConfirmedAtBlock/,
  "execution must be able to count confirmations at a snapshot block",
);
assertMatches(
  /require\(to != address\(0\), "Invalid target"\);/,
  "submitTransaction must reject zero-address targets",
);
assertMatches(
  /require\(data\.length == 0 \|\| to\.code\.length > 0, "Target is not contract"\);/,
  "contract calls must reject non-contract targets while allowing simple ETH transfers",
);
assertBefore(
  "executionInProgress[txId] = true;",
  "txn.to.call{value: txn.value}(txn.data)",
  "execution guard must be set before the external callback",
);
assertBefore(
  "txn.executed = true;",
  "txn.to.call{value: txn.value}(txn.data)",
  "transaction must be marked executed before the external callback",
);
assertBefore(
  "require(getConfirmationCountAtBlock(txId, executionBlock) >= required",
  "executionInProgress[txId] = true;",
  "execution must use a block-level confirmation snapshot before starting",
);
assertMatches(
  /function revokeConfirmation\(uint256 txId\) external onlyOwner txExists\(txId\) notExecuting\(txId\)/,
  "revocation must be blocked during execution callbacks",
);
assertIncludes(
  'require(txId < transactionCount, "Unknown transaction");',
  "confirmation, revocation, and execution must reject unknown transaction ids",
);

console.log("MultiSigWallet race-protection checks passed.");
