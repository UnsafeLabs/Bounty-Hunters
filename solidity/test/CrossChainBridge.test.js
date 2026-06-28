const { expect } = require("chai");
const { ethers } = require("ethers");
const ganache = require("ganache");
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const rootDir = path.join(__dirname, "..");
const parseEther = ethers.parseEther;

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function findImport(importPath) {
  const candidates = [
    path.join(rootDir, importPath),
    path.join(rootDir, "node_modules", importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `File not found: ${importPath}` };
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/CrossChainBridge.sol": {
        content: readSource("contracts/CrossChainBridge.sol"),
      },
      "contracts/GovernanceToken.sol": {
        content: readSource("contracts/GovernanceToken.sol"),
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = (output.errors || []).filter((error) => error.severity === "error");
  expect(errors.map((error) => error.formattedMessage)).to.deep.equal([]);
  return output.contracts;
}

function getArtifact(contracts, sourcePath, contractName) {
  const artifact = contracts[sourcePath][contractName];
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
  };
}

async function deploy(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(promiseFactory) {
  try {
    await promiseFactory();
  } catch (error) {
    expect(error).to.exist;
    return;
  }
  throw new Error("Expected transaction to revert");
}

function signatureForDigest(wallet, digest) {
  return ethers.Signature.from(wallet.signingKey.sign(digest)).serialized;
}

describe("CrossChainBridge replay protection", function () {
  let contracts;
  let tokenArtifact;
  let bridgeArtifact;
  let validator;
  let sourceSender;
  let recipient;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(contracts, "contracts/GovernanceToken.sol", "GovernanceToken");
    bridgeArtifact = getArtifact(
      contracts,
      "contracts/CrossChainBridge.sol",
      "CrossChainBridge",
    );
    validator = ethers.Wallet.createRandom();
    sourceSender = ethers.Wallet.createRandom();
    recipient = ethers.Wallet.createRandom();
  });

  async function createProvider(chainId = 31337) {
    const ganacheProvider = ganache.provider({
      chain: { chainId },
      logging: { quiet: true },
      wallet: { totalAccounts: 3 },
    });
    const provider = new ethers.BrowserProvider(ganacheProvider);
    const owner = await provider.getSigner(0);
    return { provider, owner };
  }

  async function deployBridgeFixture(chainId = 31337) {
    const { provider, owner } = await createProvider(chainId);
    const token = await deploy(owner, tokenArtifact, [parseEther("1000000")]);
    const bridge = await deploy(owner, bridgeArtifact, [
      await token.getAddress(),
      validator.address,
    ]);
    await (await token.transfer(await bridge.getAddress(), parseEther("1000"))).wait();
    return { provider, owner, token, bridge };
  }

  async function signTransfer(bridge, sender, to, amount, nonce) {
    const digest = await bridge.getTransferHash(sender, to, amount, nonce);
    return {
      digest,
      signature: signatureForDigest(validator, digest),
    };
  }

  it("constructs an EIP-712 domain with name, version, chain ID, and verifying contract", async function () {
    const { provider, bridge } = await deployBridgeFixture(31337);
    const network = await provider.getNetwork();
    const expected = ethers.TypedDataEncoder.hashDomain({
      name: "CrossChainBridge",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await bridge.getAddress(),
    });

    expect(await bridge.domainSeparator()).to.equal(expected);
  });

  it("processes a valid EIP-712 transfer and increments the sender nonce", async function () {
    const { bridge, token } = await deployBridgeFixture();
    const amount = parseEther("5");
    const nonce = await bridge.getNonce(sourceSender.address);
    const { digest, signature } = await signTransfer(
      bridge,
      sourceSender.address,
      recipient.address,
      amount,
      nonce,
    );

    expect(await bridge.verifySignature(digest, signature)).to.equal(true);
    await (
      await bridge.processTransfer(
        sourceSender.address,
        recipient.address,
        amount,
        nonce,
        signature,
      )
    ).wait();

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
    expect(await bridge.getNonce(sourceSender.address)).to.equal(nonce + 1n);
  });

  it("rejects same-chain replay with the same nonce and signature", async function () {
    const { bridge } = await deployBridgeFixture();
    const amount = parseEther("5");
    const nonce = await bridge.getNonce(sourceSender.address);
    const { signature } = await signTransfer(
      bridge,
      sourceSender.address,
      recipient.address,
      amount,
      nonce,
    );

    await (
      await bridge.processTransfer(
        sourceSender.address,
        recipient.address,
        amount,
        nonce,
        signature,
      )
    ).wait();

    await expectRevert(async () => {
      await (
        await bridge.processTransfer(
          sourceSender.address,
          recipient.address,
          amount,
          nonce,
          signature,
        )
      ).wait();
    });
  });

  it("rejects cross-chain replay because chain ID changes the digest", async function () {
    const first = await deployBridgeFixture(31337);
    const second = await deployBridgeFixture(31338);
    const amount = parseEther("5");
    const nonce = await first.bridge.getNonce(sourceSender.address);
    const { signature } = await signTransfer(
      first.bridge,
      sourceSender.address,
      recipient.address,
      amount,
      nonce,
    );

    await expectRevert(async () => {
      await (
        await second.bridge.processTransfer(
          sourceSender.address,
          recipient.address,
          amount,
          nonce,
          signature,
        )
      ).wait();
    });
  });

  it("rejects replay against a replacement contract with the same chain ID", async function () {
    const { owner, token, bridge } = await deployBridgeFixture(31337);
    const replacement = await deploy(owner, bridgeArtifact, [
      await token.getAddress(),
      validator.address,
    ]);
    await (await token.transfer(await replacement.getAddress(), parseEther("1000"))).wait();
    const amount = parseEther("5");
    const nonce = await bridge.getNonce(sourceSender.address);
    const { signature } = await signTransfer(
      bridge,
      sourceSender.address,
      recipient.address,
      amount,
      nonce,
    );

    await expectRevert(async () => {
      await (
        await replacement.processTransfer(
          sourceSender.address,
          recipient.address,
          amount,
          nonce,
          signature,
        )
      ).wait();
    });
  });

  it("rejects invalid signatures and zero-address ecrecover results", async function () {
    const { bridge } = await deployBridgeFixture();
    const amount = parseEther("5");
    const nonce = await bridge.getNonce(sourceSender.address);
    const digest = await bridge.getTransferHash(
      sourceSender.address,
      recipient.address,
      amount,
      nonce,
    );
    const invalidSignature = `0x${"00".repeat(65)}`;

    expect(await bridge.verifySignature(digest, invalidSignature)).to.equal(false);

    await expectRevert(async () => {
      await (
        await bridge.processTransfer(
          sourceSender.address,
          recipient.address,
          amount,
          nonce,
          invalidSignature,
        )
      ).wait();
    });
  });
});
