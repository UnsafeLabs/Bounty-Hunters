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
      "contracts/StakingVault.sol": {
        content: readSource("contracts/StakingVault.sol"),
      },
      "contracts/test/ReentrantStakingAttacker.sol": {
        content: readSource("contracts/test/ReentrantStakingAttacker.sol"),
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

describe("StakingVault reentrancy protection", function () {
  let provider;
  let owner;
  let user;
  let contracts;
  let tokenArtifact;
  let vaultArtifact;
  let attackerArtifact;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(contracts, "contracts/GovernanceToken.sol", "GovernanceToken");
    vaultArtifact = getArtifact(contracts, "contracts/StakingVault.sol", "StakingVault");
    attackerArtifact = getArtifact(
      contracts,
      "contracts/test/ReentrantStakingAttacker.sol",
      "ReentrantStakingAttacker",
    );
  });

  beforeEach(async function () {
    const ganacheProvider = ganache.provider({ logging: { quiet: true } });
    provider = new ethers.BrowserProvider(ganacheProvider);
    owner = await provider.getSigner(0);
    user = await provider.getSigner(1);
  });

  async function deployVaultFixture() {
    const token = await deploy(owner, tokenArtifact, [parseEther("1000000")]);
    const vault = await deploy(owner, vaultArtifact, [
      await token.getAddress(),
      parseEther("0.001"),
    ]);
    await (await owner.sendTransaction({
      to: await vault.getAddress(),
      value: parseEther("100"),
    })).wait();
    expect(await provider.getBalance(await vault.getAddress())).to.equal(parseEther("100"));
    return { token, vault };
  }

  async function stakeFromUser(token, vault, amount) {
    await (await token.transfer(await user.getAddress(), amount)).wait();
    await (await token.connect(user).approve(await vault.getAddress(), amount)).wait();
    await (await vault.connect(user).stake(amount)).wait();
  }

  async function deployFundedAttacker(token, vault, amount) {
    const attacker = await deploy(owner, attackerArtifact, [
      await vault.getAddress(),
      await token.getAddress(),
    ]);
    await (await token.transfer(await attacker.getAddress(), amount)).wait();
    await (await attacker.stake(amount)).wait();
    return attacker;
  }

  it("keeps normal staking, withdrawal, and reward claim flows working", async function () {
    const { token, vault } = await deployVaultFixture();
    const amount = parseEther("10");

    await stakeFromUser(token, vault, amount);
    expect(await provider.getBalance(await vault.getAddress())).to.equal(parseEther("100"));
    await (await vault.connect(user).withdraw(parseEther("1"))).wait();

    expect(await vault.balances(await user.getAddress())).to.equal(parseEther("9"));
    expect(await vault.totalStaked()).to.equal(parseEther("9"));

    await provider.send("evm_increaseTime", [10]);
    await provider.send("evm_mine", []);

    await (await vault.connect(user).claimRewards()).wait();
    expect(await vault.rewards(await user.getAddress())).to.equal(0n);
  });

  it("rejects recursive withdraw attempts", async function () {
    const { token, vault } = await deployVaultFixture();
    const attacker = await deployFundedAttacker(token, vault, parseEther("10"));

    await expectRevert(async () => {
      await (await attacker.attackWithdraw(parseEther("1"))).wait();
    });

    expect(await vault.balances(await attacker.getAddress())).to.equal(parseEther("10"));
    expect(await vault.totalStaked()).to.equal(parseEther("10"));
  });

  it("rejects recursive reward claim attempts", async function () {
    const { token, vault } = await deployVaultFixture();
    const attacker = await deployFundedAttacker(token, vault, parseEther("10"));

    await provider.send("evm_increaseTime", [10]);
    await provider.send("evm_mine", []);

    await expectRevert(async () => {
      await (await attacker.attackClaimRewards()).wait();
    });

    expect(await vault.rewards(await attacker.getAddress())).to.equal(0n);
    expect((await vault.getPendingRewards(await attacker.getAddress())) > 0n).to.equal(
      true,
    );
  });
});
