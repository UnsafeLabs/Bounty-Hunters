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
      "contracts/GovernanceToken.sol": {
        content: readSource("contracts/GovernanceToken.sol"),
      },
      "contracts/test/PhishingDelegate.sol": {
        content: readSource("contracts/test/PhishingDelegate.sol"),
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

describe("GovernanceToken tx.origin phishing protection", function () {
  let contracts;
  let tokenArtifact;
  let phishingArtifact;
  let owner;
  let user;
  let delegatee;
  let recipient;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(contracts, "contracts/GovernanceToken.sol", "GovernanceToken");
    phishingArtifact = getArtifact(
      contracts,
      "contracts/test/PhishingDelegate.sol",
      "PhishingDelegate",
    );
  });

  beforeEach(async function () {
    const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    owner = await provider.getSigner(0);
    user = await provider.getSigner(1);
    delegatee = await provider.getSigner(2);
    recipient = await provider.getSigner(3);
  });

  async function deployFixture() {
    const token = await deploy(owner, tokenArtifact, [parseEther("1000000")]);
    await (await token.transfer(await user.getAddress(), parseEther("100"))).wait();
    return { token };
  }

  it("does not contain tx.origin in the contract source", function () {
    const source = readSource("contracts/GovernanceToken.sol");
    expect(source.includes("tx.origin")).to.equal(false);
  });

  it("prevents a phishing contract from delegating a caller's votes", async function () {
    const { token } = await deployFixture();
    const phishing = await deploy(owner, phishingArtifact, [await token.getAddress()]);
    const userAddress = await user.getAddress();
    const delegateeAddress = await delegatee.getAddress();

    await (await phishing.connect(user).attackDelegate(delegateeAddress)).wait();

    expect(await token.delegates(userAddress)).to.equal(ethers.ZeroAddress);
    expect(await token.delegates(await phishing.getAddress())).to.equal(delegateeAddress);
    expect(await token.delegatedPower(delegateeAddress)).to.equal(0n);
    expect(await token.getVotingPower(delegateeAddress)).to.equal(0n);
  });

  it("keeps legitimate direct delegation and voting working", async function () {
    const { token } = await deployFixture();
    const userAddress = await user.getAddress();
    const delegateeAddress = await delegatee.getAddress();

    await (await token.connect(user).delegateVote(delegateeAddress)).wait();
    const proposalId = await token.connect(delegatee).createProposal.staticCall("ship it", 100);
    await (await token.connect(delegatee).createProposal("ship it", 100)).wait();
    await (await token.connect(delegatee).vote(proposalId, true)).wait();

    expect(await token.delegates(userAddress)).to.equal(delegateeAddress);
    expect(await token.getVotingPower(delegateeAddress)).to.equal(parseEther("100"));
    expect(await token.hasVoted(proposalId, delegateeAddress)).to.equal(true);
  });

  it("keeps contract-owned delegation working for legitimate contract interactions", async function () {
    const { token } = await deployFixture();
    const phishing = await deploy(owner, phishingArtifact, [await token.getAddress()]);
    const delegateeAddress = await delegatee.getAddress();

    await (await token.transfer(await phishing.getAddress(), parseEther("50"))).wait();
    await (await phishing.attackDelegate(delegateeAddress)).wait();

    expect(await token.delegatedPower(delegateeAddress)).to.equal(parseEther("50"));
    expect(await token.getVotingPower(delegateeAddress)).to.equal(parseEther("50"));
  });

  it("updates delegated voting power when delegated balances move", async function () {
    const { token } = await deployFixture();
    const delegateeAddress = await delegatee.getAddress();

    await (await token.connect(user).delegateVote(delegateeAddress)).wait();
    await (await token.connect(user).transfer(await recipient.getAddress(), parseEther("40"))).wait();

    expect(await token.delegatedPower(delegateeAddress)).to.equal(parseEther("60"));
    expect(await token.getVotingPower(delegateeAddress)).to.equal(parseEther("60"));
  });

  it("protects snapshot with Ownable onlyOwner authorization", async function () {
    const { token } = await deployFixture();

    await expectRevert(async () => {
      await (await token.connect(user).snapshot()).wait();
    });

    await (await token.connect(owner).snapshot()).wait();
    expect(await token.owner()).to.equal(await owner.getAddress());
    expect(await token.admin()).to.equal(await owner.getAddress());
  });

  it("rejects invalid self and zero-address delegations", async function () {
    const { token } = await deployFixture();

    await expectRevert(async () => {
      await (await token.connect(user).delegateVote(await user.getAddress())).wait();
    });
    await expectRevert(async () => {
      await (await token.connect(user).delegateVote(ethers.ZeroAddress)).wait();
    });
  });
});
