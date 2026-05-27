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

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint256 supply) {
        name = n;
        symbol = s;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}`;

function resolveImport(importPath) {
  if (importPath.startsWith("@openzeppelin/")) {
    const resolved = require.resolve(importPath, { paths: [solidityRoot] });
    return { contents: readFileSync(resolved, "utf8") };
  }
  return { error: `Unable to resolve ${importPath}` };
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/YieldVault.sol": {
        content: readFileSync(path.join(solidityRoot, "contracts", "YieldVault.sol"), "utf8"),
      },
      "test/MockERC20.sol": { content: mockTokenSource },
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
    vault: output.contracts["contracts/YieldVault.sol"].YieldVault,
    token: output.contracts["test/MockERC20.sol"].MockERC20,
  };
}

function artifact(contract) {
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

async function deploy(contract, signer, args = []) {
  const { abi, bytecode } = artifact(contract);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  return deployed;
}

async function increaseTime(provider, seconds) {
  await provider.request({ method: "evm_increaseTime", params: [Number(seconds)] });
  await provider.request({ method: "evm_mine", params: [] });
}

const contracts = compileContracts();
const ganacheProvider = ganache.provider({
  chain: { chainId: 31_337 },
  logging: { quiet: true },
  wallet: { deterministic: true },
});
const provider = new ethers.BrowserProvider(ganacheProvider);
const owner = await provider.getSigner(0);
const user = await provider.getSigner(1);
const ownerAddress = await owner.getAddress();
const userAddress = await user.getAddress();

async function setup() {
  const stakingToken = await deploy(contracts.token, owner, [
    "Stake Token",
    "STK",
    ethers.parseEther("1000000"),
  ]);
  const rewardToken = await deploy(contracts.token, owner, [
    "Reward Token",
    "RWD",
    ethers.parseEther("1000000"),
  ]);
  const vault = await deploy(contracts.vault, owner, [
    await stakingToken.getAddress(),
    await rewardToken.getAddress(),
  ]);
  return { stakingToken, rewardToken, vault };
}

async function prepareStake(stakingToken, vault, amount) {
  await (await stakingToken.transfer(userAddress, amount)).wait();
  await (await stakingToken.connect(user).approve(await vault.getAddress(), amount)).wait();
  await (await vault.connect(user).deposit(amount)).wait();
}

async function fundRewards(rewardToken, vault, reward) {
  await (await rewardToken.transfer(await vault.getAddress(), reward)).wait();
}

{
  const { stakingToken, rewardToken, vault } = await setup();
  await prepareStake(stakingToken, vault, 1n);
  await fundRewards(rewardToken, vault, 100n);

  await assert.rejects(async () => {
    await (await vault.connect(user).notifyRewardAmount(100n, 10n)).wait();
  });

  await assert.rejects(async () => {
    await (await vault.notifyRewardAmount(100n, 0n)).wait();
  });

  await assert.rejects(async () => {
    await (await vault.notifyRewardAmount(0n, 10n)).wait();
  });
}

{
  const { stakingToken, rewardToken, vault } = await setup();
  await prepareStake(stakingToken, vault, 1n);
  await fundRewards(rewardToken, vault, 1000n);

  await (await vault.notifyRewardAmount(1000n, 100n)).wait();
  await increaseTime(ganacheProvider, 50n);
  const midPeriod = await vault.earned(userAddress);
  assert(midPeriod > 0n && midPeriod < 1000n);

  await increaseTime(ganacheProvider, 100n);
  const atFinish = await vault.earned(userAddress);
  const rewardPerTokenAtFinish = await vault.rewardPerToken();
  assert.equal(atFinish, 1000n);

  await increaseTime(ganacheProvider, 500n);
  assert.equal(await vault.earned(userAddress), atFinish);
  assert.equal(await vault.rewardPerToken(), rewardPerTokenAtFinish);

  const userRewardBefore = await rewardToken.balanceOf(userAddress);
  await (await vault.connect(user).claimReward()).wait();
  assert.equal(await rewardToken.balanceOf(userAddress), userRewardBefore + 1000n);
}

{
  const { stakingToken, rewardToken, vault } = await setup();
  await fundRewards(rewardToken, vault, 500n);

  await (await vault.notifyRewardAmount(500n, 50n)).wait();
  const finish = await vault.periodFinish();
  await increaseTime(ganacheProvider, 75n);

  await prepareStake(stakingToken, vault, 1n);
  assert.equal(await vault.lastUpdateTime(), finish);

  await increaseTime(ganacheProvider, 25n);
  assert.equal(await vault.earned(userAddress), 0n);
}

{
  const { stakingToken, rewardToken, vault } = await setup();
  const reward = 10001n;
  const duration = 7n;

  await prepareStake(stakingToken, vault, 1n);
  await fundRewards(rewardToken, vault, reward);

  await (await vault.notifyRewardAmount(reward, duration)).wait();
  await increaseTime(ganacheProvider, duration);

  const earned = await vault.earned(userAddress);
  const precisionLoss = reward - earned;
  assert.equal(earned, 10000n);
  assert(precisionLoss * 10_000n < reward);

  const oldIntegerReward = (reward / duration) * duration;
  const oldPrecisionLoss = reward - oldIntegerReward;
  assert(oldPrecisionLoss * 10_000n > reward);
}

{
  const { stakingToken, rewardToken, vault } = await setup();
  await prepareStake(stakingToken, vault, 20n);
  await fundRewards(rewardToken, vault, 200n);

  await (await vault.notifyRewardAmount(200n, 20n)).wait();
  await increaseTime(ganacheProvider, 10n);
  await (await vault.connect(user).withdraw(5n)).wait();

  assert.equal(await vault.balanceOf(userAddress), 15n);
  assert.equal(await vault.totalSupply(), 15n);
  assert.equal(await stakingToken.balanceOf(userAddress), 5n);

  await increaseTime(ganacheProvider, 20n);
  const earned = await vault.earned(userAddress);
  const userBefore = await rewardToken.balanceOf(userAddress);
  await (await vault.connect(user).claimReward()).wait();
  assert.equal(await rewardToken.balanceOf(userAddress), userBefore + earned);
  assert.equal(await rewardToken.balanceOf(ownerAddress), ethers.parseEther("1000000") - 200n);
}
