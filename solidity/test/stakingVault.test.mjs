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
const repoRoot = path.resolve(solidityRoot, "..");

const testContractsSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimRewards() external;
}

contract MockToken is ERC20 {
    constructor() ERC20("Stake Token", "STK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ReenteringStaker {
    IStakingVault public vault;
    IERC20 public token;
    bool public attackWithdraw;
    bool public attackRewards;
    bool public tolerateReentryFailure;
    bool public reentryBlocked;
    uint256 public reentryCount;

    constructor(address vaultAddress, address tokenAddress) {
        vault = IStakingVault(vaultAddress);
        token = IERC20(tokenAddress);
    }

    function stakeAndApprove(uint256 amount) external {
        token.approve(address(vault), amount);
        vault.stake(amount);
    }

    function withdrawAttack(uint256 amount) external {
        attackWithdraw = true;
        tolerateReentryFailure = false;
        vault.withdraw(amount);
        attackWithdraw = false;
    }

    function withdrawProbe(uint256 amount) external {
        attackWithdraw = true;
        tolerateReentryFailure = true;
        vault.withdraw(amount);
        attackWithdraw = false;
    }

    function rewardAttack() external {
        attackRewards = true;
        tolerateReentryFailure = false;
        vault.claimRewards();
        attackRewards = false;
    }

    function rewardProbe() external {
        attackRewards = true;
        tolerateReentryFailure = true;
        vault.claimRewards();
        attackRewards = false;
    }

    receive() external payable {
        if (attackWithdraw && reentryCount == 0) {
            reentryCount++;
            if (tolerateReentryFailure) {
                (bool ok, ) = address(vault).call(
                    abi.encodeWithSelector(IStakingVault.withdraw.selector, msg.value)
                );
                reentryBlocked = !ok;
            } else {
                vault.withdraw(msg.value);
            }
        }
        if (attackRewards && reentryCount == 0) {
            reentryCount++;
            if (tolerateReentryFailure) {
                (bool ok, ) = address(vault).call(
                    abi.encodeWithSelector(IStakingVault.claimRewards.selector)
                );
                reentryBlocked = !ok;
            } else {
                vault.claimRewards();
            }
        }
    }
}
`;

function resolveImport(importPath) {
  if (importPath.startsWith("@openzeppelin/")) {
    const resolved = require.resolve(importPath, { paths: [solidityRoot] });
    return { contents: readFileSync(resolved, "utf8") };
  }

  const localPath = path.join(repoRoot, importPath);
  try {
    return { contents: readFileSync(localPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function sliceSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  assert.ok(start < end, `${startMarker} must appear before ${endMarker}`);
  return source.slice(start, end);
}

function assertBefore(source, beforeMarker, afterMarker) {
  const before = source.indexOf(beforeMarker);
  const after = source.indexOf(afterMarker);
  assert.notEqual(before, -1, `Missing source marker: ${beforeMarker}`);
  assert.notEqual(after, -1, `Missing source marker: ${afterMarker}`);
  assert.ok(before < after, `${beforeMarker} must appear before ${afterMarker}`);
}

function compileContracts() {
  const vaultSource = readFileSync(path.join(solidityRoot, "contracts", "StakingVault.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "solidity/contracts/StakingVault.sol": {
        content: vaultSource,
      },
      "test/StakingHarness.sol": {
        content: testContractsSource,
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);

  assert.match(vaultSource, /import\s+"@openzeppelin\/contracts\/utils\/ReentrancyGuard.sol";/);
  assert.match(vaultSource, /contract\s+StakingVault\s+is\s+ReentrancyGuard/);
  assert.match(vaultSource, /function\s+withdraw\(uint256 amount\)\s+external\s+nonReentrant/);
  assert.match(vaultSource, /function\s+claimRewards\(\)\s+external\s+nonReentrant/);

  const withdrawBody = sliceSource(vaultSource, "function withdraw", "function claimRewards");
  assertBefore(withdrawBody, "balances[msg.sender] -= amount;", ".call{value: amount}");
  assertBefore(withdrawBody, "totalStaked -= amount;", ".call{value: amount}");

  const claimRewardsBody = sliceSource(
    vaultSource,
    "function claimRewards",
    "function getStakedBalance",
  );
  assertBefore(claimRewardsBody, "rewards[msg.sender] = 0;", ".call{value: reward}");

  return {
    vault: output.contracts["solidity/contracts/StakingVault.sol"].StakingVault,
    token: output.contracts["test/StakingHarness.sol"].MockToken,
    attacker: output.contracts["test/StakingHarness.sol"].ReenteringStaker,
  };
}

async function deploy(contract, signer, args = []) {
  const factory = new ethers.ContractFactory(
    contract.abi,
    `0x${contract.evm.bytecode.object}`,
    signer,
  );
  const deployment = await factory.deploy(...args);
  await deployment.waitForDeployment();
  return deployment;
}

async function expectRevert(action) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error.shortMessage ?? error.message), /revert/i);
    return;
  }
  assert.fail("Expected revert");
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
const userAddress = await user.getAddress();
const token = await deploy(contracts.token, owner);
const vault = await deploy(contracts.vault, owner, [
  await token.getAddress(),
  ethers.parseEther("0.01"),
]);
const vaultAddress = await vault.getAddress();

await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("50") });

await (await token.mint(userAddress, ethers.parseEther("10"))).wait();
await (await token.connect(user).approve(vaultAddress, ethers.parseEther("10"))).wait();
await (await vault.connect(user).stake(ethers.parseEther("10"))).wait();
assert.equal(await vault.getStakedBalance(userAddress), ethers.parseEther("10"));

const normalWithdraw = await (await vault.connect(user).withdraw(ethers.parseEther("2"))).wait();
assert.equal(await vault.getStakedBalance(userAddress), ethers.parseEther("8"));
assert.equal(await vault.totalStaked(), ethers.parseEther("8"));
assert.ok(normalWithdraw.gasUsed < 150_000n);

await ganacheProvider.request({ method: "evm_increaseTime", params: [10] });
await ganacheProvider.request({ method: "evm_mine", params: [] });
const rewardBefore = await vault.getPendingRewards(userAddress);
assert.ok(rewardBefore > 0n);
const rewardClaim = await (await vault.connect(user).claimRewards()).wait();
assert.equal(await vault.rewards(userAddress), 0n);
assert.ok(rewardClaim.gasUsed < 150_000n);

const attacker = await deploy(contracts.attacker, owner, [vaultAddress, await token.getAddress()]);
const attackerAddress = await attacker.getAddress();
await (await token.mint(attackerAddress, ethers.parseEther("5"))).wait();
await (await attacker.stakeAndApprove(ethers.parseEther("5"))).wait();

await expectRevert(async () => {
  const tx = await attacker.withdrawAttack(ethers.parseEther("5"));
  await tx.wait();
});
assert.equal(await vault.getStakedBalance(attackerAddress), ethers.parseEther("5"));
assert.equal(await attacker.reentryCount(), 0n);

const withdrawProbe = await deploy(contracts.attacker, owner, [vaultAddress, await token.getAddress()]);
const withdrawProbeAddress = await withdrawProbe.getAddress();
await (await token.mint(withdrawProbeAddress, ethers.parseEther("5"))).wait();
await (await withdrawProbe.stakeAndApprove(ethers.parseEther("5"))).wait();
await (await withdrawProbe.withdrawProbe(ethers.parseEther("1"))).wait();
assert.equal(await withdrawProbe.reentryCount(), 1n);
assert.equal(await withdrawProbe.reentryBlocked(), true);
assert.equal(await vault.getStakedBalance(withdrawProbeAddress), ethers.parseEther("4"));

await ganacheProvider.request({ method: "evm_increaseTime", params: [10] });
await ganacheProvider.request({ method: "evm_mine", params: [] });
await expectRevert(async () => {
  const tx = await attacker.rewardAttack();
  await tx.wait();
});
assert.ok(await vault.getPendingRewards(attackerAddress) > 0n);

const rewardProbe = await deploy(contracts.attacker, owner, [vaultAddress, await token.getAddress()]);
const rewardProbeAddress = await rewardProbe.getAddress();
await (await token.mint(rewardProbeAddress, ethers.parseEther("2"))).wait();
await (await rewardProbe.stakeAndApprove(ethers.parseEther("2"))).wait();
await ganacheProvider.request({ method: "evm_increaseTime", params: [10] });
await ganacheProvider.request({ method: "evm_mine", params: [] });
await (await rewardProbe.rewardProbe()).wait();
assert.equal(await rewardProbe.reentryCount(), 1n);
assert.equal(await rewardProbe.reentryBlocked(), true);
assert.equal(await vault.rewards(rewardProbeAddress), 0n);

console.log("StakingVault reentrancy tests passed");
