// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingVaultReentrantAttacker {
    enum AttackMode {
        None,
        Withdraw,
        ClaimRewards
    }

    StakingVault public immutable vault;
    IERC20 public immutable stakingToken;

    AttackMode public attackMode;
    uint256 public reentryCount;
    uint256 public attackAmount;

    constructor(address _vault, address _stakingToken) {
        vault = StakingVault(payable(_vault));
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
        if (reentryCount > 0) return;

        reentryCount = 1;
        if (attackMode == AttackMode.Withdraw) {
            vault.withdraw(attackAmount);
        } else if (attackMode == AttackMode.ClaimRewards) {
            vault.claimRewards();
        }
    }
}
