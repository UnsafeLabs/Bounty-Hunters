// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function approve(address spender, uint256 value) external returns (bool);
}

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
}

contract ReentrantWithdrawAttacker {
    IStakingVault public immutable vault;
    IERC20Like public immutable stakingToken;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor(address vault_, address stakingToken_) {
        vault = IStakingVault(vault_);
        stakingToken = IERC20Like(stakingToken_);
    }

    function attackWithdraw(uint256 amount) external {
        stakingToken.approve(address(vault), amount);
        vault.stake(amount);
        vault.withdraw(amount);
    }

    receive() external payable {
        if (reentryAttempts == 0) {
            reentryAttempts = 1;
            try vault.withdraw(1) {
                reentrySucceeded = true;
            } catch {}
        }
    }
}
