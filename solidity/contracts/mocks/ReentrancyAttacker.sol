// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../StakingVault.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ReentrancyAttacker {
    StakingVault public vault;
    MockERC20 public token;
    uint256 public attackCount;
    bool public attacking;

    constructor(address _vault, address _token) {
        vault = StakingVault(_vault);
        token = MockERC20(_token);
    }

    function setup(uint256 stakeAmount) external {
        token.mint(address(this), stakeAmount);
        token.approve(address(vault), stakeAmount);
        vault.stake(stakeAmount);
    }

    function attackWithdraw() external {
        attacking = true;
        attackCount = 0;
        uint256 balance = vault.getStakedBalance(address(this));
        vault.withdraw(balance);
    }

    function attackClaim() external {
        attacking = true;
        attackCount = 0;
        vault.claimRewards();
    }

    receive() external payable {
        if (attacking && attackCount < 1) {
            attackCount++;
            uint256 balance = vault.getStakedBalance(address(this));
            if (balance > 0) {
                vault.withdraw(balance);
            }
        }
    }
}
