import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const VALIDATOR = "validator";
const ALICE = "alice";
const BOB = "bob";

class MockToken {
  constructor() {
    this.balances = new Map();
  }

  mint(account, amount) {
    this.balances.set(account, this.balanceOf(account) + BigInt(amount));
  }

  balanceOf(account) {
    return this.balances.get(account) ?? 0n;
  }

  transfer(from, to, amount) {
    const value = BigInt(amount);
    assert(this.balanceOf(from) >= value, "insufficient token balance");
    this.balances.set(from, this.balanceOf(from) - value);
    this.balances.set(to, this.balanceOf(to) + value);
    return true;
  }
}

class CrossChainBridgeModel {
  constructor(token, validator = VALIDATOR, chainId = 1n, address = "bridge-1") {
    assert(token !== ZERO_ADDRESS, "Invalid token");
    assert(validator !== ZERO_ADDRESS, "Invalid validator");
    this.token = token;
    this.validator = validator;
    this.chainId = BigInt(chainId);
    this.address = address;
    this.nonces = new Map();
    this.processed = new Set();
    this.domainSeparator = digest(`CrossChainBridge|1|${this.chainId}|${this.address}`);
    this.events = [];
  }

  nonce(sender) {
    return this.nonces.get(sender) ?? 0n;
  }

  initiateTransfer(sender, amount, targetChain) {
    amount = BigInt(amount);
    assert(amount > 0n, "Amount must be > 0");
    const senderNonce = this.nonce(sender);
    this.nonces.set(sender, senderNonce + 1n);
    this.token.transfer(sender, this.address, amount);
    this.events.push(["TransferInitiated", sender, amount, BigInt(targetChain), senderNonce]);
  }

  hashTransfer(sender, recipient, amount, transferNonce) {
    return digest(`${this.domainSeparator}|BridgeTransfer|${sender}|${recipient}|${BigInt(amount)}|${BigInt(transferNonce)}`);
  }

  signTransfer(sender, recipient, amount, transferNonce, signer = this.validator) {
    return { signer, digest: this.hashTransfer(sender, recipient, amount, transferNonce), malformed: false };
  }

  verifySignature(expectedDigest, signature) {
    assert(!signature.malformed, "Invalid signature length");
    assert(signature.signer !== ZERO_ADDRESS, "Invalid signer");
    return signature.signer === this.validator && signature.digest === expectedDigest;
  }

  processTransfer(sender, recipient, amount, transferNonce, signature) {
    amount = BigInt(amount);
    transferNonce = BigInt(transferNonce);
    assert(sender !== ZERO_ADDRESS, "Invalid sender");
    assert(recipient !== ZERO_ADDRESS, "Invalid recipient");
    assert(amount > 0n, "Amount must be > 0");
    assert(transferNonce === this.nonce(sender), "Invalid nonce");

    const transferHash = this.hashTransfer(sender, recipient, amount, transferNonce);
    assert(!this.processed.has(transferHash), "Already processed");
    assert(this.verifySignature(transferHash, signature), "Invalid signature");

    this.processed.add(transferHash);
    this.nonces.set(sender, transferNonce + 1n);
    this.token.transfer(this.address, recipient, amount);
    this.events.push(["TransferProcessed", transferHash, sender, recipient, amount]);
  }
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function setup() {
  const token = new MockToken();
  token.mint("bridge-1", 1_000_000n);
  token.mint("bridge-2", 1_000_000n);
  token.mint("bridge-upgrade", 1_000_000n);
  token.mint(ALICE, 1_000n);
  return { token, bridge: new CrossChainBridgeModel(token) };
}

test("domain separator includes name, version, chain id, and verifying contract", () => {
  const { bridge } = setup();

  assert.equal(bridge.domainSeparator, digest("CrossChainBridge|1|1|bridge-1"));
});

test("valid transfer increments the sender nonce and pays the recipient", () => {
  const { token, bridge } = setup();
  const signature = bridge.signTransfer(ALICE, BOB, 100n, bridge.nonce(ALICE));

  bridge.processTransfer(ALICE, BOB, 100n, 0n, signature);

  assert.equal(bridge.nonce(ALICE), 1n);
  assert.equal(token.balanceOf(BOB), 100n);
});

test("same-chain replay is rejected by the sender nonce", () => {
  const { bridge } = setup();
  const signature = bridge.signTransfer(ALICE, BOB, 100n, 0n);

  bridge.processTransfer(ALICE, BOB, 100n, 0n, signature);

  assert.throws(() => bridge.processTransfer(ALICE, BOB, 100n, 0n, signature), /Invalid nonce/);
});

test("cross-chain replay is rejected by the EIP-712 domain", () => {
  const { token, bridge } = setup();
  const otherChain = new CrossChainBridgeModel(token, VALIDATOR, 2n, "bridge-1");
  const signature = bridge.signTransfer(ALICE, BOB, 100n, 0n);

  assert.throws(() => otherChain.processTransfer(ALICE, BOB, 100n, 0n, signature), /Invalid signature/);
});

test("post-upgrade replay is rejected by the verifying contract address", () => {
  const { token, bridge } = setup();
  const upgradedBridge = new CrossChainBridgeModel(token, VALIDATOR, 1n, "bridge-upgrade");
  const signature = bridge.signTransfer(ALICE, BOB, 100n, 0n);

  assert.throws(() => upgradedBridge.processTransfer(ALICE, BOB, 100n, 0n, signature), /Invalid signature/);
});

test("zero-address signer and malformed signatures are rejected", () => {
  const { bridge } = setup();
  const zeroSignerSignature = bridge.signTransfer(ALICE, BOB, 100n, 0n, ZERO_ADDRESS);
  const malformedSignature = { signer: VALIDATOR, digest: "bad", malformed: true };

  assert.throws(() => bridge.processTransfer(ALICE, BOB, 100n, 0n, zeroSignerSignature), /Invalid signer/);
  assert.throws(() => bridge.processTransfer(ALICE, BOB, 100n, 0n, malformedSignature), /Invalid signature length/);
});

test("frontend can query sender nonce before signing", () => {
  const { bridge } = setup();

  assert.equal(bridge.nonce(ALICE), 0n);
  bridge.initiateTransfer(ALICE, 10n, 137n);
  assert.equal(bridge.nonce(ALICE), 1n);
});
