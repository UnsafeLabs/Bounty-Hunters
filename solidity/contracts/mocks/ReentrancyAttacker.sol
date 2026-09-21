// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStakingVault {
    function withdraw(uint256 amount) external;
    function claimRewards() external;
    function stake(uint256 amount) external;
    function balances(address) external view returns (uint256);
    function stakingToken() external view returns (address);
}

interface IERC20Min {
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Reenters withdraw/claimRewards from receive(); nested call must fail closed.
contract ReentrancyAttacker {
    IStakingVault public vault;
    uint256 public attackAmount;
    bool public attacking;
    bool public reenterClaim;

    constructor(address _vault) {
        vault = IStakingVault(_vault);
    }

    function arm(uint256 amount, bool claim) external {
        attackAmount = amount;
        reenterClaim = claim;
    }

    function stakeFrom(uint256 amount) external {
        address token = vault.stakingToken();
        IERC20Min(token).transferFrom(msg.sender, address(this), amount);
        IERC20Min(token).approve(address(vault), amount);
        vault.stake(amount);
    }

    function attackWithdraw() external {
        attacking = true;
        vault.withdraw(attackAmount);
        attacking = false;
    }

    function attackClaim() external {
        attacking = true;
        vault.claimRewards();
        attacking = false;
    }

    receive() external payable {
        if (!attacking) return;
        // No try/catch: nested nonReentrant (or CEI insufficient-balance) reverts
        // the ETH transfer and thus the outer withdraw/claim.
        if (reenterClaim) {
            vault.claimRewards();
        } else {
            vault.withdraw(attackAmount);
        }
    }
}
