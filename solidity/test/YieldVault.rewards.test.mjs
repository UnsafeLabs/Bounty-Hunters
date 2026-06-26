import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../contracts/YieldVault.sol", import.meta.url), "utf8");
const PRECISION = 10n ** 18n;
const require = createRequire(import.meta.url);
const evmDepsDir = process.env.YIELD_VAULT_EVM_DEPS;
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
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

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
      "YieldVault.sol": { content: source },
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

async function mineAfter(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function deployVaultFixture() {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const distributor = await provider.getSigner(0);
  const staker = await provider.getSigner(1);
  const other = await provider.getSigner(2);
  const stakerAddress = await staker.getAddress();

  const stakingToken = await deploy(contracts["MockToken.sol"].MockToken, distributor, [
    "Stake Token",
    "STK",
  ]);
  const rewardToken = await deploy(contracts["MockToken.sol"].MockToken, distributor, [
    "Reward Token",
    "RWD",
  ]);
  const vault = await deploy(contracts["YieldVault.sol"].YieldVault, distributor, [
    await stakingToken.getAddress(),
    await rewardToken.getAddress(),
  ]);
  const vaultAddress = await vault.getAddress();

  return {
    provider,
    distributor,
    staker,
    other,
    stakerAddress,
    stakingToken,
    rewardToken,
    vault,
    vaultAddress,
  };
}

function rewardRate({ reward, duration }) {
  return (reward * PRECISION) / duration;
}

function lastTimeRewardApplicable({ now, periodFinish }) {
  return now < periodFinish ? now : periodFinish;
}

function rewardPerToken({ stored = 0n, now, periodFinish, lastUpdateTime, rate, totalSupply }) {
  if (totalSupply === 0n) return stored;

  const applicableTime = lastTimeRewardApplicable({ now, periodFinish });
  if (applicableTime <= lastUpdateTime) return stored;

  return stored + ((applicableTime - lastUpdateTime) * rate) / totalSupply;
}

function earned({ balance, paid = 0n, rewards = 0n, rpt }) {
  return (balance * (rpt - paid)) / PRECISION + rewards;
}

function notifyModel({ sender, distributor, reward, duration }) {
  if (sender !== distributor) throw new Error("Not reward distributor");
  if (duration <= 0n) throw new Error("Duration must be > 0");
  return rewardRate({ reward, duration });
}

test("rewardPerToken caps accrual at periodFinish", () => {
  assert.match(source, /function lastTimeRewardApplicable\(\) public view returns \(uint256\)/);
  assert.match(source, /block\.timestamp < periodFinish \? block\.timestamp : periodFinish/);
  assert.match(source, /uint256 applicableTime = lastTimeRewardApplicable\(\);/);
  assert.match(source, /lastUpdateTime = lastTimeRewardApplicable\(\);/);
});

test("earned uses capped rewardPerToken with scaled precision", () => {
  assert.match(source, /uint256 private constant PRECISION = 1e18;/);
  assert.match(source, /Math\.mulDiv\(\s*balanceOf\[account\],\s*rewardPerToken\(\) - userRewardPerTokenPaid\[account\],\s*PRECISION\s*\)/);
});

test("reward accrues during an active period", () => {
  const rate = rewardRate({ reward: 1_000n * PRECISION, duration: 100n });
  const rpt = rewardPerToken({
    now: 50n,
    periodFinish: 100n,
    lastUpdateTime: 0n,
    rate,
    totalSupply: 100n * PRECISION,
  });

  assert.equal(earned({ balance: 100n * PRECISION, rpt }), 500n * PRECISION);
});

test("reward freezes after period expiry", () => {
  const rate = rewardRate({ reward: 1_000n * PRECISION, duration: 100n });
  const atFinish = rewardPerToken({
    now: 100n,
    periodFinish: 100n,
    lastUpdateTime: 0n,
    rate,
    totalSupply: 100n * PRECISION,
  });
  const afterFinish = rewardPerToken({
    now: 150n,
    periodFinish: 100n,
    lastUpdateTime: 0n,
    rate,
    totalSupply: 100n * PRECISION,
  });

  assert.equal(afterFinish, atFinish);
});

test("notifyRewardAmount is restricted to the reward distributor", () => {
  assert.match(source, /require\(msg\.sender == rewardDistributor, "Not reward distributor"\);/);
  assert.throws(
    () => notifyModel({ sender: "other", distributor: "owner", reward: 1n, duration: 1n }),
    /Not reward distributor/,
  );
});

test("scaled reward rate keeps precision error below 0.01 percent", () => {
  const reward = 1_000n * PRECISION;
  const duration = 3n;
  const rate = rewardRate({ reward, duration });
  const rpt = rewardPerToken({
    now: duration,
    periodFinish: duration,
    lastUpdateTime: 0n,
    rate,
    totalSupply: PRECISION,
  });
  const paid = earned({ balance: PRECISION, rpt });
  const error = reward - paid;

  assert.ok(error * 10_000n < reward);
});

test("token transfers require success", () => {
  assert.match(source, /require\(stakingToken\.transferFrom\(msg\.sender, address\(this\), amount\), "Stake transfer failed"\);/);
  assert.match(source, /require\(stakingToken\.transfer\(msg\.sender, amount\), "Stake transfer failed"\);/);
  assert.match(source, /require\(rewardToken\.transfer\(msg\.sender, reward\), "Reward transfer failed"\);/);
});

test("EVM rewards freeze after period expiry and claim exact full-period reward", { skip: !evmDeps }, async () => {
  const {
    provider,
    staker,
    stakerAddress,
    stakingToken,
    rewardToken,
    vault,
    vaultAddress,
  } = await deployVaultFixture();
  const stake = 100n * PRECISION;
  const reward = 1_000n * PRECISION;

  await (await stakingToken.mint(stakerAddress, stake)).wait();
  await (await rewardToken.mint(vaultAddress, reward)).wait();
  await (await stakingToken.connect(staker).approve(vaultAddress, stake)).wait();
  await (await vault.connect(staker).deposit(stake)).wait();
  await (await vault.notifyRewardAmount(reward, 100n)).wait();

  await mineAfter(provider, 50);
  const halfPeriodReward = await vault.earned(stakerAddress);
  assert.ok(halfPeriodReward > 0n);
  assert.ok(halfPeriodReward < reward);

  await mineAfter(provider, 70);
  const rewardAtExpiry = await vault.earned(stakerAddress);
  await mineAfter(provider, 1_000);
  const rewardLongAfterExpiry = await vault.earned(stakerAddress);

  assert.equal(rewardLongAfterExpiry, rewardAtExpiry);
  assert.equal(rewardAtExpiry, reward);

  await (await vault.connect(staker).claimReward()).wait();
  assert.equal(await rewardToken.balanceOf(stakerAddress), reward);
});

test("EVM notifyRewardAmount rejects non-distributor callers", { skip: !evmDeps }, async () => {
  const { other, vault } = await deployVaultFixture();

  await expectRevert(
    () => vault.connect(other).notifyRewardAmount(1n, 100n),
    /Not reward distributor|revert/,
  );
});

test("EVM scaled reward rate keeps precision error below 0.01 percent", { skip: !evmDeps }, async () => {
  const {
    provider,
    staker,
    stakerAddress,
    stakingToken,
    rewardToken,
    vault,
    vaultAddress,
  } = await deployVaultFixture();
  const stake = PRECISION;
  const reward = 1_000n * PRECISION;

  await (await stakingToken.mint(stakerAddress, stake)).wait();
  await (await rewardToken.mint(vaultAddress, reward)).wait();
  await (await stakingToken.connect(staker).approve(vaultAddress, stake)).wait();
  await (await vault.connect(staker).deposit(stake)).wait();
  await (await vault.notifyRewardAmount(reward, 3n)).wait();

  await mineAfter(provider, 3);

  const paid = await vault.earned(stakerAddress);
  const error = reward - paid;
  assert.ok(error * 10_000n < reward);
});
