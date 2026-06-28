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
      "contracts/YieldVault.sol": {
        content: readSource("contracts/YieldVault.sol"),
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

async function increaseTime(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

function expectWithin(actual, expected, tolerance) {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(diff <= tolerance, `${actual} differs from ${expected} by ${diff}`).to.equal(
    true,
  );
}

describe("YieldVault reward period accounting", function () {
  let contracts;
  let tokenArtifact;
  let vaultArtifact;
  let provider;
  let distributor;
  let staker;
  let lateStaker;
  let outsider;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(contracts, "contracts/GovernanceToken.sol", "GovernanceToken");
    vaultArtifact = getArtifact(contracts, "contracts/YieldVault.sol", "YieldVault");
  });

  beforeEach(async function () {
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    distributor = await provider.getSigner(0);
    staker = await provider.getSigner(1);
    lateStaker = await provider.getSigner(2);
    outsider = await provider.getSigner(3);
  });

  async function deployFixture() {
    const stakingToken = await deploy(distributor, tokenArtifact, [parseEther("1000000")]);
    const rewardToken = await deploy(distributor, tokenArtifact, [parseEther("1000000")]);
    const vault = await deploy(distributor, vaultArtifact, [
      await stakingToken.getAddress(),
      await rewardToken.getAddress(),
    ]);

    for (const signer of [staker, lateStaker]) {
      await (
        await stakingToken.transfer(await signer.getAddress(), parseEther("1000"))
      ).wait();
      await (
        await stakingToken.connect(signer).approve(await vault.getAddress(), parseEther("1000"))
      ).wait();
    }
    await (await rewardToken.transfer(await vault.getAddress(), parseEther("10000"))).wait();

    return { stakingToken, rewardToken, vault };
  }

  async function startRewardProgram(vault, stakeAmount, rewardAmount, duration) {
    await (await vault.connect(staker).deposit(stakeAmount)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(rewardAmount, duration)).wait();
  }

  it("accrues rewards during the active period", async function () {
    const { vault } = await deployFixture();

    await startRewardProgram(vault, parseEther("100"), parseEther("100"), 100);
    await increaseTime(provider, 50);

    expectWithin(
      await vault.earned(await staker.getAddress()),
      parseEther("50"),
      parseEther("1"),
    );
  });

  it("freezes rewardPerToken and earned rewards after period finish", async function () {
    const { vault } = await deployFixture();

    await startRewardProgram(vault, parseEther("100"), parseEther("100"), 100);
    await increaseTime(provider, 150);

    const rewardPerTokenAtFinish = await vault.rewardPerToken();
    const earnedAtFinish = await vault.earned(await staker.getAddress());

    await increaseTime(provider, 200);

    expect(await vault.rewardPerToken()).to.equal(rewardPerTokenAtFinish);
    expect(await vault.earned(await staker.getAddress())).to.equal(earnedAtFinish);
    expectWithin(earnedAtFinish, parseEther("100"), 1n);
  });

  it("does not accrue phantom rewards for deposits after the period ends", async function () {
    const { vault } = await deployFixture();

    await startRewardProgram(vault, parseEther("100"), parseEther("100"), 100);
    await increaseTime(provider, 150);
    await (await vault.connect(lateStaker).deposit(parseEther("100"))).wait();
    await increaseTime(provider, 100);

    expect(await vault.earned(await lateStaker.getAddress())).to.equal(0n);
  });

  it("restricts notifyRewardAmount to the authorized distributor", async function () {
    const { vault } = await deployFixture();

    await expectRevert(async () => {
      await (await vault.connect(outsider).notifyRewardAmount(parseEther("100"), 100)).wait();
    });

    await (await vault.connect(distributor).notifyRewardAmount(parseEther("100"), 100)).wait();
    expect((await vault.periodFinish()) > 0n).to.equal(true);
  });

  it("keeps reward precision error below 0.01 percent", async function () {
    const { vault } = await deployFixture();
    const reward = parseEther("1000") + 1n;

    await startRewardProgram(vault, parseEther("1"), reward, 7);
    await increaseTime(provider, 7);

    const earned = await vault.earned(await staker.getAddress());
    const error = reward > earned ? reward - earned : earned - reward;
    expect(error * 10000n <= reward).to.equal(true);
  });

  it("keeps deposit, withdrawal, and claim flows working", async function () {
    const { rewardToken, vault } = await deployFixture();
    const stakerAddress = await staker.getAddress();

    await startRewardProgram(vault, parseEther("100"), parseEther("100"), 100);
    await increaseTime(provider, 25);
    await (await vault.connect(staker).withdraw(parseEther("40"))).wait();
    await increaseTime(provider, 75);

    const rewardBeforeClaim = await vault.earned(stakerAddress);
    const tokenBalanceBeforeClaim = await rewardToken.balanceOf(stakerAddress);
    await (await vault.connect(staker).claimReward()).wait();

    expect(await vault.balanceOf(stakerAddress)).to.equal(parseEther("60"));
    expect(await vault.rewards(stakerAddress)).to.equal(0n);
    expect((await rewardToken.balanceOf(stakerAddress)) - tokenBalanceBeforeClaim).to.equal(
      rewardBeforeClaim,
    );
  });
});
