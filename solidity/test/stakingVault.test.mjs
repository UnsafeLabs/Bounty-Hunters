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

const attackerSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimRewards() external;
}

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract ReenteringStaker {
    enum Mode {
        None,
        Withdraw,
        Claim
    }

    IStakingVault public vault;
    IERC20Like public token;
    Mode public mode;
    uint256 public withdrawAmount;
    uint256 public receiveCount;

    constructor(address vault_, address token_) {
        vault = IStakingVault(vault_);
        token = IERC20Like(token_);
    }

    function stakeAmount(uint256 amount) external {
        require(token.approve(address(vault), amount), "approve");
        vault.stake(amount);
    }

    function attackWithdraw(uint256 amount) external {
        withdrawAmount = amount;
        mode = Mode.Withdraw;
        vault.withdraw(amount);
        mode = Mode.None;
    }

    function attackClaimRewards() external {
        mode = Mode.Claim;
        vault.claimRewards();
        mode = Mode.None;
    }

    receive() external payable {
        receiveCount++;

        if (mode == Mode.Withdraw) {
            mode = Mode.None;
            vault.withdraw(withdrawAmount);
        } else if (mode == Mode.Claim) {
            mode = Mode.None;
            vault.claimRewards();
        }
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
      "contracts/StakingVault.sol": {
        content: readFileSync(path.join(solidityRoot, "contracts", "StakingVault.sol"), "utf8"),
      },
      "test/MockERC20.sol": { content: mockTokenSource },
      "test/ReenteringStaker.sol": { content: attackerSource },
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
    vault: output.contracts["contracts/StakingVault.sol"].StakingVault,
    token: output.contracts["test/MockERC20.sol"].MockERC20,
    attacker: output.contracts["test/ReenteringStaker.sol"].ReenteringStaker,
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
  await provider.request({ method: "evm_increaseTime", params: [seconds] });
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

async function setup(rewardRate = ethers.parseEther("1")) {
  const token = await deploy(contracts.token, owner, [
    "Stake Token",
    "STK",
    ethers.parseEther("1000000"),
  ]);
  const vault = await deploy(contracts.vault, owner, [await token.getAddress(), rewardRate]);
  return { token, vault };
}

{
  const { token, vault } = await setup();
  const amount = 100n;
  await (await token.transfer(userAddress, amount)).wait();
  await (await token.connect(user).approve(await vault.getAddress(), amount)).wait();
  await (await vault.connect(user).stake(amount)).wait();

  await (await owner.sendTransaction({ to: await vault.getAddress(), value: 1_000n })).wait();
  await (await vault.connect(user).withdraw(40n)).wait();

  assert.equal(await vault.getStakedBalance(userAddress), 60n);
  assert.equal(await vault.totalStaked(), 60n);
}

{
  const { token, vault } = await setup();
  const amount = 50n;
  await (await token.transfer(userAddress, amount)).wait();
  await (await token.connect(user).approve(await vault.getAddress(), amount)).wait();
  await (await vault.connect(user).stake(amount)).wait();
  await increaseTime(ganacheProvider, 10);

  const pending = await vault.getPendingRewards(userAddress);
  assert.ok(pending > 0n);
  await (await owner.sendTransaction({ to: await vault.getAddress(), value: pending + 1_000n })).wait();
  await (await vault.connect(user).claimRewards()).wait();

  assert.equal(await vault.rewards(userAddress), 0n);
}

{
  const { token, vault } = await setup();
  const attacker = await deploy(contracts.attacker, owner, [await vault.getAddress(), await token.getAddress()]);
  const attackerAddress = await attacker.getAddress();
  const amount = 100n;

  await (await token.transfer(attackerAddress, amount)).wait();
  await (await attacker.stakeAmount(amount)).wait();
  await (await owner.sendTransaction({ to: await vault.getAddress(), value: 1_000n })).wait();

  await assert.rejects(async () => {
    await (await attacker.attackWithdraw(amount)).wait();
  });

  assert.equal(await vault.getStakedBalance(attackerAddress), amount);
  assert.equal(await vault.totalStaked(), amount);
}

{
  const { token, vault } = await setup();
  const attacker = await deploy(contracts.attacker, owner, [await vault.getAddress(), await token.getAddress()]);
  const attackerAddress = await attacker.getAddress();
  const amount = 25n;

  await (await token.transfer(attackerAddress, amount)).wait();
  await (await attacker.stakeAmount(amount)).wait();
  await increaseTime(ganacheProvider, 10);

  const pending = await vault.getPendingRewards(attackerAddress);
  assert.ok(pending > 0n);
  await (await owner.sendTransaction({ to: await vault.getAddress(), value: pending + 1_000n })).wait();

  await assert.rejects(async () => {
    await (await attacker.attackClaimRewards()).wait();
  });

  assert.ok(await vault.getPendingRewards(attackerAddress) > 0n);
}

console.log("StakingVault reentrancy and normal flow tests passed");
