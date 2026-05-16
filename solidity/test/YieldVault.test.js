const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const contractPath = path.join(__dirname, "..", "contracts", "YieldVault.sol");
const source = fs.readFileSync(contractPath, "utf8");
const ierc20 = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
`;

let server;
let provider;
let accounts;
let compiled;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/YieldVault.sol": { content: source },
      "@openzeppelin/contracts/token/ERC20/IERC20.sol": { content: ierc20 },
      "test/MockERC20.sol": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
`,
      },
    },
    settings: {
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(name, signer, args = []) {
  const artifact =
    compiled["contracts/YieldVault.sol"]?.[name] ?? compiled["test/MockERC20.sol"][name];
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    signer,
  );
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function increaseTime(seconds) {
  await provider.send("evm_increaseTime", [Number(seconds)]);
  await provider.send("evm_mine", []);
}

async function deployVault() {
  const [owner, staker, other] = accounts;
  const stakingToken = await deploy("MockERC20", owner);
  const rewardToken = await deploy("MockERC20", owner);
  const vault = await deploy("YieldVault", owner, [
    await stakingToken.getAddress(),
    await rewardToken.getAddress(),
  ]);
  const stakeAmount = ethers.parseEther("100");
  const rewardAmount = ethers.parseEther("1000");

  await (await stakingToken.mint(staker.address, stakeAmount)).wait();
  await (await stakingToken.connect(staker).approve(await vault.getAddress(), stakeAmount)).wait();
  await (await rewardToken.mint(await vault.getAddress(), rewardAmount)).wait();

  return { owner, staker, other, stakingToken, rewardToken, vault, stakeAmount, rewardAmount };
}

before(async () => {
  compiled = compileContracts();
  server = ganache.server({ logging: { quiet: true } });
  await server.listen(0);
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${server.address().port}`);
  accounts = await provider.listAccounts();
});

after(async () => {
  await provider?.destroy();
  await server?.close();
});

test("accrues rewards during the active period", async () => {
  const { owner, staker, vault, stakeAmount } = await deployVault();
  const reward = ethers.parseEther("100");

  await (await vault.connect(staker).deposit(stakeAmount)).wait();
  await (await vault.connect(owner).notifyRewardAmount(reward, 100)).wait();
  await increaseTime(50);

  assert.equal(await vault.earned(staker.address), reward / 2n);
});

test("freezes reward accrual after the reward period ends", async () => {
  const { owner, staker, vault, stakeAmount } = await deployVault();
  const reward = ethers.parseEther("100");

  await (await vault.connect(staker).deposit(stakeAmount)).wait();
  await (await vault.connect(owner).notifyRewardAmount(reward, 100)).wait();
  await increaseTime(100);
  const earnedAtFinish = await vault.earned(staker.address);
  await increaseTime(100);

  assert.equal(earnedAtFinish, reward);
  assert.equal(await vault.earned(staker.address), earnedAtFinish);
});

test("restricts notifyRewardAmount to the distributor", async () => {
  const { other, vault } = await deployVault();

  await assert.rejects(vault.connect(other).notifyRewardAmount(ethers.parseEther("1"), 100));
});

test("keeps precision loss below 0.01 percent", async () => {
  const { owner, staker, vault, stakeAmount } = await deployVault();
  const reward = ethers.parseEther("100");

  await (await vault.connect(staker).deposit(stakeAmount)).wait();
  await (await vault.connect(owner).notifyRewardAmount(reward, 3)).wait();
  await increaseTime(3);
  const earned = await vault.earned(staker.address);
  const error = reward - earned;

  assert(error * 10000n < reward);
});

test("claim and withdraw flows still function", async () => {
  const { owner, staker, rewardToken, stakingToken, vault, stakeAmount } = await deployVault();
  const reward = ethers.parseEther("100");

  await (await vault.connect(staker).deposit(stakeAmount)).wait();
  await (await vault.connect(owner).notifyRewardAmount(reward, 100)).wait();
  await increaseTime(100);
  await (await vault.connect(staker).claimReward()).wait();
  await (await vault.connect(staker).withdraw(stakeAmount)).wait();

  assert.equal(await rewardToken.balanceOf(staker.address), reward);
  assert.equal(await stakingToken.balanceOf(staker.address), stakeAmount);
  assert.equal(await vault.balanceOf(staker.address), 0n);
});
