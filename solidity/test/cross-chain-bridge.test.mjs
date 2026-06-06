import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import ganache from "ganache";
import solc from "solc";
import { ethers } from "ethers";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "..");
const validator = ethers.Wallet.createRandom();
const mnemonic = "test test test test test test test test test test test junk";

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
}

function findImports(importPath) {
  try {
    const resolvedPath = importPath.startsWith("@")
      ? require.resolve(importPath, { paths: [projectDir] })
      : path.join(projectDir, importPath);
    return { contents: fs.readFileSync(resolvedPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CrossChainBridge.sol": { content: readSource("contracts/CrossChainBridge.sol") },
      "test/MockERC20.sol": { content: readSource("test/MockERC20.sol") },
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts;
}

function getArtifact(contracts, name) {
  for (const contractGroup of Object.values(contracts)) {
    if (contractGroup[name]) {
      return contractGroup[name];
    }
  }
  throw new Error(`Missing compiled artifact for ${name}`);
}

async function deploy(contracts, signer, name, args = []) {
  const artifact = getArtifact(contracts, name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function signDigest(digest) {
  return validator.signingKey.sign(digest).serialized;
}

async function expectRevert(action, pattern) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error), pattern);
    return;
  }
  assert.fail("Expected transaction to revert");
}

const contracts = compileContracts();

async function setup(chainId = 31_337) {
  const provider = new ethers.BrowserProvider(
    ganache.provider({
      chain: { chainId },
      logging: { quiet: true },
      wallet: { mnemonic, totalAccounts: 4, defaultBalance: 1000 },
    }),
  );

  const [owner, recipient] = await Promise.all([0, 1].map((index) => provider.getSigner(index)));
  const token = await deploy(contracts, owner, "MockERC20", ["Bridge Token", "BRG"]);
  const bridge = await deploy(contracts, owner, "CrossChainBridge", [
    await token.getAddress(),
    validator.address,
  ]);

  await (await token.mint(await bridge.getAddress(), 1_000_000n)).wait();

  return {
    provider,
    owner,
    recipient,
    token,
    bridge,
    recipientAddress: await recipient.getAddress(),
    bridgeAddress: await bridge.getAddress(),
  };
}

{
  const { recipientAddress, token, bridge } = await setup();
  const amount = 1_000n;
  const nonce = await bridge.nonces(recipientAddress);
  const digest = await bridge.getTransferHash(recipientAddress, amount, nonce);
  const signature = signDigest(digest);

  await (await bridge.processTransfer(recipientAddress, amount, nonce, signature)).wait();

  assert.equal(await token.balanceOf(recipientAddress), amount);
  assert.equal(await bridge.nonces(recipientAddress), nonce + 1n);
}

{
  const { recipientAddress, bridge } = await setup();
  const amount = 1_000n;
  const nonce = await bridge.nonces(recipientAddress);
  const digest = await bridge.getTransferHash(recipientAddress, amount, nonce);
  const signature = signDigest(digest);

  await (await bridge.processTransfer(recipientAddress, amount, nonce, signature)).wait();

  await expectRevert(
    () => bridge.processTransfer.staticCall(recipientAddress, amount, nonce, signature),
    /Invalid nonce|Already processed/,
  );
}

{
  const source = await setup(31_337);
  const target = await setup(31_338);
  const amount = 1_000n;
  const nonce = await source.bridge.nonces(source.recipientAddress);
  const digest = await source.bridge.getTransferHash(source.recipientAddress, amount, nonce);
  const signature = signDigest(digest);

  assert.equal(source.bridgeAddress, target.bridgeAddress);
  assert.notEqual(await source.bridge.DOMAIN_SEPARATOR(), await target.bridge.DOMAIN_SEPARATOR());
  await expectRevert(
    () => target.bridge.processTransfer.staticCall(target.recipientAddress, amount, nonce, signature),
    /Invalid signature/,
  );
}

{
  const first = await setup();
  const amount = 1_000n;
  const nonce = await first.bridge.nonces(first.recipientAddress);
  const digest = await first.bridge.getTransferHash(first.recipientAddress, amount, nonce);
  const signature = signDigest(digest);
  const secondBridge = await deploy(contracts, first.owner, "CrossChainBridge", [
    await first.token.getAddress(),
    validator.address,
  ]);
  await (await first.token.mint(await secondBridge.getAddress(), 1_000_000n)).wait();

  assert.notEqual(first.bridgeAddress, await secondBridge.getAddress());
  await expectRevert(
    () => secondBridge.processTransfer.staticCall(first.recipientAddress, amount, nonce, signature),
    /Invalid signature/,
  );
}

{
  const { recipientAddress, bridge } = await setup();
  const amount = 1_000n;
  const nonce = await bridge.nonces(recipientAddress);
  const digest = await bridge.getTransferHash(recipientAddress, amount, nonce);
  const invalidSignature = `0x${"00".repeat(65)}`;

  assert.equal(await bridge.verifySignature(digest, invalidSignature), false);
  await expectRevert(
    () => bridge.processTransfer.staticCall(recipientAddress, amount, nonce, invalidSignature),
    /Invalid signature/,
  );
}

{
  const { provider, bridge, bridgeAddress } = await setup();
  const network = await provider.getNetwork();
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const expected = ethers.keccak256(abi.encode(
    ["bytes32", "bytes32", "bytes32", "uint256", "address"],
    [
      ethers.id("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
      ethers.id("CrossChainBridge"),
      ethers.id("1"),
      network.chainId,
      bridgeAddress,
    ],
  ));

  assert.equal(await bridge.DOMAIN_SEPARATOR(), expected);
}

console.log("CrossChainBridge replay protection regressions passed");
