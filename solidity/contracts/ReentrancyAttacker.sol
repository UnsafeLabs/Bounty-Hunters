// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Stakes then attempts reentrancy on withdraw; should revert after fix.
contract ReentrancyAttacker {
    StakingVault public vault;
    IERC20 public token;
    uint256 public attackAmount;
    uint256 public depth;

    constructor(StakingVault _vault, IERC20 _token) {
        vault = _vault;
        token = _token;
    }

    function fundAndStake(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        token.approve(address(vault), amount);
        vault.stake(amount);
        attackAmount = amount;
    }

    function attack() external {
        depth = 0;
        vault.withdraw(attackAmount);
    }

    receive() external payable {
        if (depth < 3) {
            depth++;
            vault.withdraw(attackAmount);
        }
    }
}
