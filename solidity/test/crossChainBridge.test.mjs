import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solidityRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(solidityRoot, "..");

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Bridge Token", "BRG") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
`;

function resolveImport(importPath) {
  if (importPath.startsWith("@openzeppelin/")) {
    const resolved = require.resolve(importPath, { paths: [solidityRoot] });
    return { contents: readFileSync(resolved, "utf8") };
  }

  const localPath = path.join(repoRoot, importPath);
  try {
    return { contents: readFileSync(localPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "solidity/contracts/CrossChainBridge.sol": {
        content: readFileSync(
          path.join(solidityRoot, "contracts", "CrossChainBridge.sol"),
          "utf8",
        ),
      },
      "test/MockToken.sol": {
        content: mockTokenSource,
      },
    },
    settings: {
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);

  return {
    bridge: output.contracts["solidity/contracts/CrossChainBridge.sol"].CrossChainBridge,
    token: output.contracts["test/MockToken.sol"].MockToken,
  };
}

async function deploy(contract, signer, args = []) {
  const factory = new ethers.ContractFactory(
    contract.abi,
    `0x${contract.evm.bytecode.object}`,
    signer,
  );
  const deployment = await factory.deploy(...args);
  await deployment.waitForDeployment();
  return deployment;
}

async function expectRevert(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    const message = String(error.shortMessage ?? error.message);
    if (expectedMessage !== undefined && !message.includes(expectedMessage)) {
      assert.match(message, /revert/i);
    }
    return;
  }
  assert.fail(`Expected revert matching ${expectedMessage}`);
}

const contracts = compileContracts();
const ganacheProvider = ganache.provider({
  chain: { chainId: 31_337 },
  logging: { quiet: true },
  wallet: { deterministic: true },
});
const provider = new ethers.BrowserProvider(ganacheProvider);
const initialAccounts = Object.values(ganacheProvider.getInitialAccounts());
const owner = await provider.getSigner(0);
const validator = new ethers.Wallet(initialAccounts[1].secretKey);
const recipient = await provider.getSigner(2);
const recipientAddress = await recipient.getAddress();
const attacker = await provider.getSigner(3);
const attackerAddress = await attacker.getAddress();
const chainId = 31_337n;

const token = await deploy(contracts.token, owner);
const bridge = await deploy(contracts.bridge, owner, [await token.getAddress(), validator.address]);
await (await token.mint(await bridge.getAddress(), ethers.parseEther("1000"))).wait();

const types = {
  BridgeTransfer: [
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};

async function signBridgeTransfer(targetBridge, recipientAddress, amount, transferNonce) {
  const verifyingContract = await targetBridge.getAddress();
  return validator.signTypedData(
    {
      name: "CrossChainBridge",
      version: "1",
      chainId,
      verifyingContract,
    },
    types,
    {
      recipient: recipientAddress,
      amount,
      nonce: transferNonce,
      chainId,
      verifyingContract,
    },
  );
}

const transferAmount = ethers.parseEther("10");
const firstSignature = await signBridgeTransfer(bridge, recipientAddress, transferAmount, 0);
const bridgeAddress = await bridge.getAddress();
const firstDigest = await bridge.hashTransfer(recipientAddress, transferAmount, 0);
const typedDomain = {
  name: "CrossChainBridge",
  version: "1",
  chainId,
  verifyingContract: bridgeAddress,
};
const typedValue = {
  recipient: recipientAddress,
  amount: transferAmount,
  nonce: 0,
  chainId,
  verifyingContract: bridgeAddress,
};
const ethersDigest = ethers.TypedDataEncoder.hash(typedDomain, types, typedValue);
assert.equal(firstDigest, ethersDigest);
assert.equal(await bridge.domainSeparator(), ethers.TypedDataEncoder.hashDomain(typedDomain));
assert.equal(await bridge.recoverSigner(firstDigest, firstSignature), validator.address);
const wrongChainDigest = ethers.TypedDataEncoder.hash(
  { ...typedDomain, chainId: chainId + 1n },
  types,
  { ...typedValue, chainId: chainId + 1n },
);
assert.notEqual(ethers.recoverAddress(wrongChainDigest, firstSignature), validator.address);
await (await bridge.connect(attacker).processTransfer(
  recipientAddress,
  transferAmount,
  0,
  firstSignature,
)).wait();

assert.equal(await token.balanceOf(recipientAddress), transferAmount);
assert.equal(await bridge.nonces(recipientAddress), 1n);
await expectRevert(
  async () => {
    const tx = await bridge.connect(attacker).processTransfer(
      recipientAddress,
      transferAmount,
      0,
      firstSignature,
    );
    await tx.wait();
  },
  "Invalid nonce",
);

const secondBridge = await deploy(contracts.bridge, owner, [
  await token.getAddress(),
  validator.address,
]);
await (await token.mint(await secondBridge.getAddress(), ethers.parseEther("1000"))).wait();
await expectRevert(
  async () => {
    const tx = await secondBridge.connect(attacker).processTransfer(
      recipientAddress,
      transferAmount,
      0,
      firstSignature,
    );
    await tx.wait();
  },
  "Invalid signature",
);

const invalidSignature = `0x${"00".repeat(65)}`;
assert.equal(
  await bridge.verifySignature(await bridge.hashTransfer(recipientAddress, 1, 1), invalidSignature),
  false,
);
await expectRevert(
  async () => {
    const tx = await bridge.connect(attacker).processTransfer(
      recipientAddress,
      1,
      1,
      invalidSignature,
    );
    await tx.wait();
  },
  "Invalid signature",
);

const secondSignature = await signBridgeTransfer(bridge, recipientAddress, 1, 1);
await (await bridge.connect(attacker).processTransfer(
  recipientAddress,
  1,
  1,
  secondSignature,
)).wait();
assert.equal(await bridge.nonces(recipientAddress), 2n);

const senderFund = ethers.parseEther("25");
await (await token.mint(attackerAddress, senderFund)).wait();
await (await token.connect(attacker).approve(await bridge.getAddress(), senderFund)).wait();
await (await bridge.connect(attacker).initiateTransfer(senderFund, 42)).wait();
assert.equal(await bridge.outboundNonces(attackerAddress), 1n);

console.log("CrossChainBridge replay-protection tests passed");
