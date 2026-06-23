// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStakingVault {
    function withdraw(uint256 amount) external;
    function claimRewards() external;
    function balances(address) external view returns (uint256);
}

/// @notice Malicious contract that attempts reentrancy attacks
/// Used in tests to verify the StakingVault is protected
contract MaliciousContract {
    IStakingVault public vault;

    constructor(address _vault) {
        vault = IStakingVault(_vault);
    }

    receive() external payable {
        // Attempt recursive withdraw — should be blocked by ReentrancyGuard
        try vault.withdraw(1 ether) {} catch {}
    }

    function attackWithValue() external payable {
        // Fund the vault directly so the malicious contract has a balance
        // Then attempt to withdraw, triggering reentrancy on receive
        (bool ok,) = address(vault).call{value: msg.value}("");
        require(ok, "send failed");
    }

    function attackClaimRewards() external payable {
        // Attempt to claim rewards recursively
        try vault.claimRewards() {} catch {}
    }
}
