// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract StakingReentrancyAttacker {
    StakingVault public vault;
    uint256 public withdrawAmount;
    enum AttackType { None, Withdraw, ClaimRewards }

    AttackType private attackType;
    uint256 private attackCount;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
    }

    function doStake(uint256 amount) external {
        IERC20 token = vault.stakingToken();
        token.approve(address(vault), amount);
        vault.stake(amount);
        withdrawAmount = amount;
    }

    function attackWithdraw() external {
        attackType = AttackType.Withdraw;
        attackCount = 0;
        vault.withdraw(withdrawAmount);
    }

    function attackClaimRewards() external {
        attackType = AttackType.ClaimRewards;
        attackCount = 0;
        vault.claimRewards();
    }

    receive() external payable {
        if (attackType != AttackType.None && attackCount < 2) {
            attackCount++;
            if (attackType == AttackType.Withdraw) {
                vault.withdraw(withdrawAmount);
            } else {
                vault.claimRewards();
            }
        }
    }
}
