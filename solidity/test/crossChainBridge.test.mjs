import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const externalModules = process.env.SOLIDITY_TEST_NODE_MODULES;
const require = createRequire(
  externalModules
    ? path.join(externalModules, "package.json")
    : import.meta.url
);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const solidityDir = path.resolve(testDir, "..");
const repoRoot = path.resolve(solidityDir, "..");
const externalRoot = externalModules
  ? path.join(externalModules, "node_modules")
  : path.join(solidityDir, "node_modules");

const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const bridgeSource = fs.readFileSync(
  path.join(solidityDir, "contracts", "CrossChainBridge.sol"),
  "utf8"
);

const tokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Bridge Token", "BTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
`;

function findImport(importPath) {
  const candidates = [
    path.join(repoRoot, importPath),
    path.join(externalRoot, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `Import not found: ${importPath}` };
}

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "CrossChainBridge.sol": { content: bridgeSource },
      "MockToken.sol": { content: tokenSource },
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

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImport })
  );
  const errors = (output.errors ?? []).filter(
    (error) => error.severity === "error"
  );
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
  return output.contracts;
}

async function deploy(factory, signer, ...args) {
  const contract = await factory.connect(signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRejects(promise, expectedMessage) {
  await assert.rejects(
    promise,
    (error) => String(error).includes(expectedMessage),
    `Expected revert containing ${expectedMessage}`
  );
}

function typedData(chainId, verifyingContract) {
  return {
    domain: {
      name: "CrossChainBridge",
      version: "1",
      chainId,
      verifyingContract,
    },
    types: {
      BridgeTransfer: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    },
  };
}

async function setup(chainId = 31337) {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({
      chain: { chainId },
      logging: { quiet: true },
      wallet: { totalAccounts: 4 },
    })
  );
  const [deployer, recipient] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
  ]);
  const validator = ethers.Wallet.createRandom();

  const tokenArtifact = contracts["MockToken.sol"].MockToken;
  const bridgeArtifact = contracts["CrossChainBridge.sol"].CrossChainBridge;
  const Token = new ethers.ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    deployer
  );
  const Bridge = new ethers.ContractFactory(
    bridgeArtifact.abi,
    bridgeArtifact.evm.bytecode.object,
    deployer
  );

  const token = await deploy(Token, deployer);
  const bridge = await deploy(
    Bridge,
    deployer,
    await token.getAddress(),
    validator.address
  );
  await (await token.mint(await bridge.getAddress(), ethers.parseEther("1000"))).wait();

  return { provider, deployer, recipient, validator, token, bridge, Bridge };
}

async function signRelease(validator, bridge, recipient, amount, nonce) {
  const network = await bridge.runner.provider.getNetwork();
  const data = typedData(network.chainId, await bridge.getAddress());
  return validator.signTypedData(data.domain, data.types, {
    recipient,
    amount,
    nonce,
  });
}

async function run() {
  {
    const { recipient, validator, token, bridge } = await setup();
    const recipientAddress = await recipient.getAddress();
    const amount = ethers.parseEther("12");
    const nonce = await bridge.nonces(recipientAddress);
    const signature = await signRelease(
      validator,
      bridge,
      recipientAddress,
      amount,
      nonce
    );

    const digest = await bridge.getTransferDigest(recipientAddress, amount, nonce);
    assert.equal(await bridge.verifySignature(digest, signature), true);

    await (await bridge.processTransfer(recipientAddress, amount, nonce, signature)).wait();
    assert.equal(await token.balanceOf(recipientAddress), amount);
    assert.equal(await bridge.nonces(recipientAddress), nonce + 1n);

    await expectRejects(
      bridge.processTransfer.staticCall(recipientAddress, amount, nonce, signature),
      "Invalid nonce"
    );
  }

  {
    const first = await setup(31337);
    const second = await setup(31338);
    const recipientAddress = await second.recipient.getAddress();
    const amount = ethers.parseEther("3");
    const signature = await signRelease(
      first.validator,
      first.bridge,
      recipientAddress,
      amount,
      0
    );

    await expectRejects(
      second.bridge.processTransfer.staticCall(
        recipientAddress,
        amount,
        0,
        signature
      ),
      "Invalid signature"
    );
  }

  {
    const { deployer, recipient, validator, token, bridge, Bridge } = await setup();
    const replacement = await deploy(
      Bridge,
      deployer,
      await token.getAddress(),
      validator.address
    );
    await (await token.mint(await replacement.getAddress(), ethers.parseEther("1000"))).wait();

    const recipientAddress = await recipient.getAddress();
    const amount = ethers.parseEther("4");
    const signature = await signRelease(
      validator,
      bridge,
      recipientAddress,
      amount,
      0
    );

    await expectRejects(
      replacement.processTransfer.staticCall(
        recipientAddress,
        amount,
        0,
        signature
      ),
      "Invalid signature"
    );
  }

  {
    const { recipient, bridge } = await setup();
    const recipientAddress = await recipient.getAddress();
    const amount = ethers.parseEther("1");
    const badSignature = `0x${"00".repeat(65)}`;

    await expectRejects(
      bridge.processTransfer.staticCall(
        recipientAddress,
        amount,
        0,
        badSignature
      ),
      "Invalid signature"
    );
  }

  {
    const { provider, bridge } = await setup(42161);
    const network = await provider.getNetwork();
    const expected = ethers.TypedDataEncoder.hashDomain({
      name: "CrossChainBridge",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await bridge.getAddress(),
    });
    assert.equal(await bridge.domainSeparator(), expected);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
