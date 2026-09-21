const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault Reentrancy Protection", function () {
  let vault;
  let owner, attacker, user;
  let Malicious;

  beforeEach(async function () {
    [owner, attacker, user] = await ethers.getSigners();

    // Deploy the StakingVault contract
    const Vault = await ethers.getContractFactory("StakingVault");
    vault = await Vault.deploy();
    await vault.deployed();

    // Deploy a malicious contract that will try to re-enter withdraw()
    const MaliciousFactory = await ethers.getContractFactory(
      `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.0;

      interface IVault {
        function withdraw() external;
        function claimRewards() external;
      }

      contract Malicious {
        IVault public vault;
        address public owner;

        constructor(address _vault) {
          vault = IVault(_vault);
          owner = msg.sender;
        }

        // Fallback that attempts to re-enter withdraw()
        receive() external payable {
          // Try to call withdraw again (re-entrancy)
          if (address(vault).balance > 0) {
            vault.withdraw();
          }
        }

        function attackWithdraw() external payable {
          // Deposit some ETH first
          (bool sent,) = address(vault).call{value: msg.value}(
            abi.encodeWithSignature("deposit()")
          );
          require(sent, "deposit failed");

          // Initiate withdrawal which will trigger fallback
          vault.withdraw();
        }

        // Fallback that attempts to re-enter claimRewards()
        fallback() external payable {
          // Try to call claimRewards again (re-entrancy)
          if (address(vault).balance > 0) {
            vault.claimRewards();
          }
        }

        function attackClaimRewards() external payable {
          // Assume rewards have been set manually for testing
          vault.claimRewards();
        }
      }
      `
    );
    Malicious = await MaliciousFactory.deploy(vault.address);
    await Malicious.deployed();
  });

  it("should prevent re-entrancy on withdraw()", async function () {
    // User deposits 1 ETH
    await vault.connect(user).deposit({ value: ethers.utils.parseEther("1") });

    // Transfer some reward to the malicious contract to make it have a balance
    await owner.sendTransaction({
      to: Malicious.address,
      value: ethers.utils.parseEther("0.1"),
    });

    // Attacker tries to attack via withdraw
    await expect(
      Malicious.connect(attacker).attackWithdraw({ value: ethers.utils.parseEther("0.5") })
    ).to.be.reverted; // Revert due to nonReentrant guard
  });

  it("should prevent re-entrancy on claimRewards()", async function () {
    // Manually set a reward for the malicious contract (using internal function via owner)
    // For simplicity we directly call the internal _accrueReward via a helper contract
    const Helper = await ethers.getContractFactory("StakingVault");
    const helper = await Helper.attach(vault.address);
    await helper._accrueReward(Malicious.address, ethers.utils.parseEther("0.2"));

    // Attacker attempts to claim rewards which triggers fallback re-entrancy
    await expect(
      Malicious.connect(attacker).attackClaimRewards()
    ).to.be.reverted; // Revert due to nonReentrant guard
  });
});
