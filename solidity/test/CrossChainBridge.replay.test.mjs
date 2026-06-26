import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../contracts/CrossChainBridge.sol", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const evmDepsDir = process.env.CROSS_CHAIN_BRIDGE_EVM_DEPS;
const evmDeps = evmDepsDir
  ? {
      solc: require(`${evmDepsDir}/solc`),
      ganache: require(`${evmDepsDir}/ganache`),
      ethers: require(`${evmDepsDir}/ethers`).ethers,
    }
  : null;

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
`;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "CrossChainBridge.sol": { content: source },
      "MockToken.sol": { content: mockTokenSource },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(
    evmDeps.solc.compile(JSON.stringify(input), {
      import: (path) => {
        if (path.startsWith("@openzeppelin/")) {
          return { contents: readFileSync(`${evmDepsDir}/${path}`, "utf8") };
        }
        return { error: `File not found: ${path}` };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(contract, signer, args = []) {
  const factory = new evmDeps.ethers.ContractFactory(
    contract.abi,
    contract.evm.bytecode.object,
    signer,
  );
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  return deployed;
}

async function expectRevert(action, pattern) {
  await assert.rejects(async () => {
    const tx = await action();
    if (tx?.wait) {
      await tx.wait();
    }
  }, pattern);
}

function transferTypes() {
  return {
    BridgeTransfer: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
  };
}

async function signBridgeTransfer({
  validator,
  sender,
  recipient,
  amount,
  nonce,
  chainId,
  verifyingContract,
}) {
  return validator.signTypedData(
    {
      name: "CrossChainBridge",
      version: "1",
      chainId,
      verifyingContract,
    },
    transferTypes(),
    {
      sender,
      recipient,
      amount,
      nonce,
      chainId,
      verifyingContract,
    },
  );
}

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

test("EVM rejects same-chain, cross-chain, and replacement-contract replay", { skip: !evmDeps }, async () => {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const deployer = await provider.getSigner(0);
  const recipient = await provider.getSigner(1);
  const recipientAddress = await recipient.getAddress();
  const sender = evmDeps.ethers.Wallet.createRandom();
  const validator = evmDeps.ethers.Wallet.createRandom();
  const chainId = (await provider.getNetwork()).chainId;

  const token = await deploy(contracts["MockToken.sol"].MockToken, deployer);
  const bridgeA = await deploy(contracts["CrossChainBridge.sol"].CrossChainBridge, deployer, [
    await token.getAddress(),
    validator.address,
  ]);
  const bridgeB = await deploy(contracts["CrossChainBridge.sol"].CrossChainBridge, deployer, [
    await token.getAddress(),
    validator.address,
  ]);
  const bridgeAAddress = await bridgeA.getAddress();
  const bridgeBAddress = await bridgeB.getAddress();

  const amount = 100n;
  await (await token.mint(bridgeAAddress, amount * 10n)).wait();
  await (await token.mint(bridgeBAddress, amount * 10n)).wait();

  const signature = await signBridgeTransfer({
    validator,
    sender: sender.address,
    recipient: recipientAddress,
    amount,
    nonce: 0n,
    chainId,
    verifyingContract: bridgeAAddress,
  });

  await (
    await bridgeA["processTransfer(address,address,uint256,uint256,bytes)"](
      sender.address,
      recipientAddress,
      amount,
      0n,
      signature,
    )
  ).wait();

  assert.equal(await token.balanceOf(recipientAddress), amount);
  assert.equal(await bridgeA.nonces(sender.address), 1n);

  await expectRevert(
    () =>
      bridgeA["processTransfer(address,address,uint256,uint256,bytes)"](
        sender.address,
        recipientAddress,
        amount,
        0n,
        signature,
      ),
    /Invalid nonce|revert/,
  );

  const wrongChainSignature = await signBridgeTransfer({
    validator,
    sender: sender.address,
    recipient: recipientAddress,
    amount,
    nonce: 1n,
    chainId: chainId + 1n,
    verifyingContract: bridgeAAddress,
  });

  await expectRevert(
    () =>
      bridgeA["processTransfer(address,address,uint256,uint256,bytes)"](
        sender.address,
        recipientAddress,
        amount,
        1n,
        wrongChainSignature,
      ),
    /Invalid signature|revert/,
  );

  const replacementSender = evmDeps.ethers.Wallet.createRandom();
  const replacementSignature = await signBridgeTransfer({
    validator,
    sender: replacementSender.address,
    recipient: recipientAddress,
    amount,
    nonce: 0n,
    chainId,
    verifyingContract: bridgeAAddress,
  });

  await expectRevert(
    () =>
      bridgeB["processTransfer(address,address,uint256,uint256,bytes)"](
        replacementSender.address,
        recipientAddress,
        amount,
        0n,
        replacementSignature,
      ),
    /Invalid signature|revert/,
  );
});

test("EVM domain separator and zero-address recovery checks match EIP-712", { skip: !evmDeps }, async () => {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const deployer = await provider.getSigner(0);
  const recipient = await provider.getSigner(1);
  const recipientAddress = await recipient.getAddress();
  const validator = evmDeps.ethers.Wallet.createRandom();
  const chainId = (await provider.getNetwork()).chainId;

  const token = await deploy(contracts["MockToken.sol"].MockToken, deployer);
  const bridge = await deploy(contracts["CrossChainBridge.sol"].CrossChainBridge, deployer, [
    await token.getAddress(),
    validator.address,
  ]);
  const bridgeAddress = await bridge.getAddress();

  const expectedDomainSeparator = evmDeps.ethers.TypedDataEncoder.hashDomain({
    name: "CrossChainBridge",
    version: "1",
    chainId,
    verifyingContract: bridgeAddress,
  });
  assert.equal(await bridge.DOMAIN_SEPARATOR(), expectedDomainSeparator);

  const digest = await bridge.transferDigest(
    validator.address,
    recipientAddress,
    1n,
    0n,
  );
  const zeroRecoverSignature = evmDeps.ethers.concat([
    evmDeps.ethers.ZeroHash,
    evmDeps.ethers.ZeroHash,
    "0x1b",
  ]);

  await assert.rejects(
    () => bridge.verifySignature(digest, zeroRecoverSignature),
    /Invalid signer|revert/,
  );
});
