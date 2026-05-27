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
const rootDir = path.resolve(__dirname, "..");

const mockErc20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}`;

function findImport(importPath) {
  try {
    const resolved = require.resolve(importPath, { paths: [rootDir] });
    return { contents: readFileSync(resolved, "utf8") };
  } catch (error) {
    return { error: `File not found: ${importPath}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "YieldVault.sol": {
        content: readFileSync(path.join(rootDir, "contracts", "YieldVault.sol"), "utf8"),
      },
      "MockERC20.sol": {
        content: mockErc20Source,
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));

  return {
    YieldVault: output.contracts["YieldVault.sol"].YieldVault,
    MockERC20: output.contracts["MockERC20.sol"].MockERC20,
  };
}

async function increaseTime(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function deployFixture() {
  const contracts = compileContracts();
  const ganacheProvider = ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 4 },
    chain: { time: new Date("2026-01-01T00:00:00Z") },
  });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const [distributor, alice, bob, attacker] = await provider.listAccounts();

  const tokenFactory = new ethers.ContractFactory(
    contracts.MockERC20.abi,
    contracts.MockERC20.evm.bytecode.object,
    distributor,
  );
  const stakingToken = await tokenFactory.deploy("Stake Token", "STK");
  await stakingToken.waitForDeployment();
  const rewardToken = await tokenFactory.deploy("Reward Token", "RWD");
  await rewardToken.waitForDeployment();

  const vaultFactory = new ethers.ContractFactory(
    contracts.YieldVault.abi,
    contracts.YieldVault.evm.bytecode.object,
    distributor,
  );
  const vault = await vaultFactory.deploy(stakingToken.target, rewardToken.target);
  await vault.waitForDeployment();

  await stakingToken.mint(alice.address, ethers.parseEther("1000"));
  await stakingToken.mint(bob.address, ethers.parseEther("1000"));
  await rewardToken.mint(vault.target, ethers.parseEther("10000"));

  await stakingToken.connect(alice).approve(vault.target, ethers.MaxUint256);
  await stakingToken.connect(bob).approve(vault.target, ethers.MaxUint256);

  return { provider, distributor, alice, bob, attacker, stakingToken, rewardToken, vault };
}

describe("YieldVault", function () {
  this.timeout(20000);

  it("accrues rewards during the active reward period", async () => {
    const { provider, distributor, alice, vault } = await deployFixture();

    await vault.connect(alice).deposit(ethers.parseEther("100"));
    await vault.connect(distributor).notifyRewardAmount(ethers.parseEther("100"), 100n);
    await increaseTime(provider, 25);

    const earned = await vault.earned(alice.address);
    assert.ok(earned >= ethers.parseEther("24.999"));
    assert.ok(earned <= ethers.parseEther("25.001"));
  });

  it("freezes reward accrual after the reward period finishes", async () => {
    const { provider, distributor, alice, vault } = await deployFixture();

    await vault.connect(alice).deposit(ethers.parseEther("100"));
    await vault.connect(distributor).notifyRewardAmount(ethers.parseEther("100"), 100n);
    await increaseTime(provider, 110);
    const earnedAtFinish = await vault.earned(alice.address);
    await increaseTime(provider, 1000);
    const earnedLater = await vault.earned(alice.address);

    assert.equal(earnedLater, earnedAtFinish);
    assert.ok(earnedLater <= ethers.parseEther("100.000000000000000001"));
  });

  it("rejects reward notifications from non-distributors", async () => {
    const { attacker, vault } = await deployFixture();

    await assert.rejects(
      vault.connect(attacker).notifyRewardAmount(ethers.parseEther("100"), 100n),
      (error) => error.code === "CALL_EXCEPTION",
    );
  });

  it("keeps reward-rate precision error under 0.01 percent", async () => {
    const { provider, distributor, alice, vault } = await deployFixture();
    const reward = 100000n;
    const duration = 365n * 24n * 60n * 60n + 17n;

    await vault.connect(alice).deposit(1n);
    await vault.connect(distributor).notifyRewardAmount(reward, duration);
    await increaseTime(provider, Number(duration) + 100);

    const earned = await vault.earned(alice.address);
    const error = reward > earned ? reward - earned : earned - reward;

    assert.ok(error * 10000n < reward, `precision error too large: ${error}`);
  });

  it("supports deposit, withdrawal, and reward claim flows", async () => {
    const { provider, distributor, alice, bob, stakingToken, rewardToken, vault } =
      await deployFixture();

    await vault.connect(alice).deposit(ethers.parseEther("100"));
    await vault.connect(bob).deposit(ethers.parseEther("300"));
    await vault.connect(distributor).notifyRewardAmount(ethers.parseEther("100"), 1000n);
    await increaseTime(provider, 100);

    const earnedAlice = await vault.earned(alice.address);
    assert.ok(earnedAlice > 0n);

    await vault.connect(alice).withdraw(ethers.parseEther("50"));
    assert.equal(await stakingToken.balanceOf(alice.address), ethers.parseEther("950"));

    await vault.connect(alice).claimReward();
    const rewardBalance = await rewardToken.balanceOf(alice.address);
    assert.ok(rewardBalance > 0n);
  });
});
