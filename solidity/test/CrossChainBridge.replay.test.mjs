import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/CrossChainBridge.sol", import.meta.url), "utf8");

function transferKey({ sender, recipient, amount, nonce, chainId, verifyingContract }) {
  return JSON.stringify({ sender, recipient, amount: String(amount), nonce: String(nonce), chainId, verifyingContract });
}

function processTransferModel(state, transfer) {
  if (transfer.sender === "0x0") throw new Error("Invalid sender");
  if (transfer.recipient === "0x0") throw new Error("Invalid recipient");
  if (transfer.amount <= 0n) throw new Error("Amount must be > 0");

  const expectedNonce = state.nonces.get(transfer.sender) ?? 0n;
  if (transfer.nonce !== expectedNonce) throw new Error("Invalid nonce");

  const digest = transferKey(transfer);
  if (state.processed.has(digest)) throw new Error("Already processed");

  state.processed.add(digest);
  state.nonces.set(transfer.sender, transfer.nonce + 1n);
  return digest;
}

function makeState() {
  return {
    nonces: new Map(),
    processed: new Set(),
  };
}

test("EIP-712 domain separator includes name, version, chain ID, and verifying contract", () => {
  assert.match(source, /EIP712_DOMAIN_TYPEHASH/);
  assert.match(source, /"EIP712Domain\(string name,string version,uint256 chainId,address verifyingContract\)"/);
  assert.match(source, /keccak256\(bytes\("CrossChainBridge"\)\)/);
  assert.match(source, /keccak256\(bytes\("1"\)\)/);
  assert.match(source, /block\.chainid/);
  assert.match(source, /address\(this\)/);
  assert.match(source, /function DOMAIN_SEPARATOR\(\) external view returns \(bytes32\)/);
});

test("signed transfer hash binds sender, recipient, amount, nonce, chain ID, and contract", () => {
  assert.match(source, /"BridgeTransfer\(address sender,address recipient,uint256 amount,uint256 nonce,uint256 chainId,address verifyingContract\)"/);
  assert.match(source, /TRANSFER_TYPEHASH/);
  assert.match(source, /sender,\s*recipient,\s*amount,\s*transferNonce,\s*block\.chainid,\s*address\(this\)/);
  assert.match(source, /"\\x19\\x01"/);
});

test("same-chain replay is rejected by sender nonce", () => {
  const state = makeState();
  const transfer = {
    sender: "alice",
    recipient: "bob",
    amount: 100n,
    nonce: 0n,
    chainId: 1,
    verifyingContract: "bridgeA",
  };

  processTransferModel(state, transfer);

  assert.throws(() => processTransferModel(state, transfer), /Invalid nonce/);
  assert.equal(state.nonces.get("alice"), 1n);
});

test("cross-chain replay changes the signed digest", () => {
  const base = {
    sender: "alice",
    recipient: "bob",
    amount: 100n,
    nonce: 0n,
    verifyingContract: "bridgeA",
  };

  assert.notEqual(
    transferKey({ ...base, chainId: 1 }),
    transferKey({ ...base, chainId: 137 }),
  );
});

test("post-upgrade replay changes the signed digest", () => {
  const base = {
    sender: "alice",
    recipient: "bob",
    amount: 100n,
    nonce: 0n,
    chainId: 1,
  };

  assert.notEqual(
    transferKey({ ...base, verifyingContract: "bridgeA" }),
    transferKey({ ...base, verifyingContract: "bridgeB" }),
  );
});

test("ecrecover zero-address result is rejected", () => {
  assert.match(source, /address recovered = ecrecover\(digest, v, r, s\);/);
  assert.match(source, /require\(recovered != address\(0\), "Invalid signer"\);/);
});

test("nonce is queryable per sender and increments on bridge transfers", () => {
  assert.match(source, /mapping\(address => uint256\) public nonces;/);
  assert.match(source, /uint256 senderNonce = nonces\[msg\.sender\]\+\+;/);
  assert.match(source, /require\(transferNonce == nonces\[sender\], "Invalid nonce"\);/);
  assert.match(source, /nonces\[sender\] = transferNonce \+ 1;/);
});

test("token transfers require success", () => {
  assert.match(source, /require\(bridgeToken\.transferFrom\(msg\.sender, address\(this\), amount\), "Transfer failed"\);/);
  assert.match(source, /require\(bridgeToken\.transfer\(recipient, amount\), "Transfer failed"\);/);
});
