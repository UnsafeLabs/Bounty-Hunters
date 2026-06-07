import assert from "node:assert/strict";
import crypto from "node:crypto";
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

function bodyOf(functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} not found`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace + 1, index);
  }
  throw new Error(`${functionName} body not closed`);
}

function signatureOf(functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} not found`);
  const brace = source.indexOf("{", start);
  return source.slice(start, brace);
}

const processTransfer = bodyOf("processTransfer");
const processTransferSignature = signatureOf("processTransfer");
const getTransferHash = bodyOf("getTransferHash");
const domainSeparator = bodyOf("domainSeparator");
const verifySignature = bodyOf("verifySignature");

const cases = [
  "cross-chain replay",
  "same-chain replay",
  "post-upgrade replay",
  "invalid signature",
  "EIP-712 verification",
];

assertIncludes(
  'keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")',
  "EIP-712 domain typehash must bind name, version, chainId, and verifyingContract",
);
assertIncludes(
  'keccak256("BridgeTransfer(address sender,address recipient,uint256 amount,uint256 nonce)")',
  "transfer typehash must bind sender, recipient, amount, and nonce",
);
assertMatches(/mapping\(address => uint256\) public nonces;/, "nonce must be queryable by sender address");
assertMatches(/function getNonce\(address sender\) external view returns \(uint256\)/, "frontend nonce helper must be present");

assert.ok(domainSeparator.includes("block.chainid"), "cross-chain replay case: domain must include chain ID");
assert.ok(domainSeparator.includes("address(this)"), "post-upgrade replay case: domain must include verifying contract");
assert.ok(getTransferHash.includes("sender"), "same-chain replay case: transfer digest must include sender");
assert.ok(getTransferHash.includes("recipient"), "transfer digest must include recipient");
assert.ok(getTransferHash.includes('"\\x19\\x01"'), "EIP-712 verification case: digest must use typed-data prefix");
assert.ok(getTransferHash.includes("domainSeparator()"), "EIP-712 verification case: digest must include domain separator");

assert.ok(processTransferSignature.includes("address sender"), "processTransfer must accept the original sender");
assert.ok(processTransfer.includes('require(sender != address(0), "Invalid sender");'), "sender must be validated");
assert.ok(processTransfer.includes("require(transferNonce == nonces[sender]"), "same-chain replay must use sender nonce");
assert.ok(!processTransfer.includes("nonces[recipient]"), "recipient nonce would not satisfy the per-sender replay requirement");
assertBefore(
  "processedTransfers[transferHash] = true;",
  "bridgeToken.transfer(recipient, amount)",
  "replay marker must be written before the external token transfer",
);
assertBefore(
  "nonces[sender] = transferNonce + 1;",
  "bridgeToken.transfer(recipient, amount)",
  "sender nonce must be consumed before the external token transfer",
);

assert.ok(verifySignature.includes("ecrecover(hash, v, r, s)"), "EIP-712 digest must be recovered directly");
assert.ok(verifySignature.includes('require(v == 27 || v == 28, "Invalid signature v");'), "invalid signature case: v must be bounded");
assert.ok(
  verifySignature.includes('require(recovered != address(0), "Invalid signature recovery");'),
  "invalid signature case: zero-address ecrecover must be rejected",
);

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

class BridgeModel {
  constructor({ chainId, address, validator }) {
    this.chainId = chainId;
    this.address = address;
    this.validator = validator;
    this.nonces = new Map();
    this.processed = new Set();
  }

  nonceOf(sender) {
    return this.nonces.get(sender) ?? 0;
  }

  domain() {
    return {
      name: "CrossChainBridge",
      version: "1",
      chainId: this.chainId,
      verifyingContract: this.address,
    };
  }

  transferHash(sender, recipient, amount, nonce) {
    return digest({
      domain: this.domain(),
      type: "BridgeTransfer(address sender,address recipient,uint256 amount,uint256 nonce)",
      sender,
      recipient,
      amount,
      nonce,
    });
  }

  sign(sender, recipient, amount, nonce) {
    return {
      signer: this.validator,
      digest: this.transferHash(sender, recipient, amount, nonce),
    };
  }

  processTransfer(sender, recipient, amount, nonce, signature) {
    assert.notEqual(sender, "0x0000000000000000000000000000000000000000", "Invalid sender");
    assert.notEqual(recipient, "0x0000000000000000000000000000000000000000", "Invalid recipient");
    assert.ok(amount > 0, "Amount must be > 0");
    assert.equal(nonce, this.nonceOf(sender), "Invalid nonce");

    const transferHash = this.transferHash(sender, recipient, amount, nonce);
    assert.equal(signature.signer, this.validator, "Invalid signature recovery");
    assert.equal(signature.digest, transferHash, "Invalid signature");
    assert.equal(this.processed.has(transferHash), false, "Already processed");

    this.processed.add(transferHash);
    this.nonces.set(sender, nonce + 1);
  }
}

const validator = "0xvalidator";
const sender = "0xsender";
const recipient = "0xrecipient";

const sourceBridge = new BridgeModel({ chainId: 1, address: "0xbridgeA", validator });
const release = sourceBridge.sign(sender, recipient, 25, sourceBridge.nonceOf(sender));
sourceBridge.processTransfer(sender, recipient, 25, 0, release);
assert.throws(
  () => sourceBridge.processTransfer(sender, recipient, 25, 0, release),
  /Invalid nonce/,
  "same-chain replay must fail after the sender nonce is consumed",
);

const otherChainBridge = new BridgeModel({ chainId: 2, address: "0xbridgeA", validator });
assert.throws(
  () => otherChainBridge.processTransfer(sender, recipient, 25, 0, release),
  /Invalid signature/,
  "cross-chain replay must fail because the EIP-712 domain includes chainId",
);

const replacementBridge = new BridgeModel({ chainId: 1, address: "0xbridgeB", validator });
assert.throws(
  () => replacementBridge.processTransfer(sender, recipient, 25, 0, release),
  /Invalid signature/,
  "replacement-contract replay must fail because the EIP-712 domain includes verifyingContract",
);

const invalidSignature = {
  signer: "0x0000000000000000000000000000000000000000",
  digest: sourceBridge.transferHash(sender, recipient, 25, 1),
};
assert.throws(
  () => sourceBridge.processTransfer(sender, recipient, 25, 1, invalidSignature),
  /Invalid signature recovery/,
  "zero-address recovery must be rejected",
);

console.log(`CrossChainBridge replay tests passed: ${cases.join(", ")}.`);
