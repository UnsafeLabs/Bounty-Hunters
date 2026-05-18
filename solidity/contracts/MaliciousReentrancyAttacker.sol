// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimRewards() external;
}

/**
 * @title MaliciousReentrancyAttacker
 * @dev Contract that attempts to re-enter StakingVault's withdraw and claimRewards
 *      functions to drain funds. Should fail due to ReentrancyGuard protection.
 */
contract MaliciousReentrancyAttacker {
    IStakingVault public vault;
    IERC20 public stakingToken;
    address private owner;
    bool private attacking;
    uint256 private attackAmount;

    constructor(address _vault, address _stakingToken) {
        vault = IStakingVault(_vault);
        stakingToken = IERC20(_stakingToken);
        owner = msg.sender;
    }

    function stake() external {
        uint256 balance = stakingToken.balanceOf(address(this));
        stakingToken.approve(address(vault), balance);
        vault.stake(balance);
        attackAmount = balance;
    }

    function attackWithdraw() external {
        attacking = true;
        vault.withdraw(attackAmount);
        attacking = false;
    }

    function attackClaimRewards() external {
        attacking = true;
        vault.claimRewards();
        attacking = false;
    }

    receive() external payable {
        if (attacking) {
            // Attempt reentrancy — this should be blocked by ReentrancyGuard
            if (address(vault).balance >= attackAmount) {
                vault.withdraw(attackAmount);
            }
        }
    }

    function withdrawStolenFunds() external {
        payable(owner).transfer(address(this).balance);
    }
}
