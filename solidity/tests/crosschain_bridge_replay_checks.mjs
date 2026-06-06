import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "CrossChainBridge.sol");
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

assertIncludes(
  'keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")',
  "domain typehash must bind name, version, chainId, and verifyingContract",
);
assertIncludes(
  'keccak256("BridgeTransfer(address recipient,uint256 amount,uint256 nonce)")',
  "transfer typehash must bind recipient, amount, and nonce",
);
assertMatches(
  /function domainSeparator\(\)[\s\S]*block\.chainid[\s\S]*address\(this\)/,
  "domain separator must include current chainId and verifying contract",
);
assertMatches(
  /function getTransferHash[\s\S]*"\\x19\\x01"[\s\S]*domainSeparator\(\)[\s\S]*structHash/,
  "transfer digest must use the EIP-712 typed-data prefix",
);
assertMatches(
  /mapping\(address => uint256\) public nonces;/,
  "nonce must be queryable per account",
);
assertMatches(
  /require\(transferNonce == nonces\[recipient\], "Invalid nonce"\);/,
  "same-chain replay must be blocked by the expected account nonce",
);
assertBefore(
  "processedTransfers[transferHash] = true;",
  "bridgeToken.transfer(recipient, amount)",
  "replay marker must be written before the external token transfer",
);
assertBefore(
  "nonces[recipient] = transferNonce + 1;",
  "bridgeToken.transfer(recipient, amount)",
  "nonce must be consumed before the external token transfer",
);
assertIncludes(
  "require(recovered != address(0), \"Invalid signature recovery\");",
  "invalid ecrecover zero-address result must be rejected",
);
assertIncludes(
  "address recovered = ecrecover(hash, v, r, s);",
  "signature verification must recover the EIP-712 digest directly",
);
assertIncludes(
  "require(v == 27 || v == 28, \"Invalid signature v\");",
  "signature v must be normalized and bounded",
);

console.log("CrossChainBridge replay-protection checks passed.");
