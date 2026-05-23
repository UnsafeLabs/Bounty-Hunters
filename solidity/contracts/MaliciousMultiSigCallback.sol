// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MaliciousMultiSigCallback — simulates an owner who revokes confirmation
 * during the execution callback to try to re-execute a transaction.
 */
contract MaliciousMultiSigCallback {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    uint256 public callbackCount;
    bool public reentrancyBlocked;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function setTargetTxId(uint256 _txId) external {
        targetTxId = _txId;
    }

    // This is called when the wallet sends ETH back during executeTransaction
    receive() external payable {
        callbackCount++;
        // Try to revoke confirmation during callback
        try wallet.revokeConfirmation(targetTxId) {
            // If revoke succeeds, try to re-execute
            try wallet.executeTransaction(targetTxId) {
                // This should NOT happen — nonReentrant should block
            } catch {
                reentrancyBlocked = true;
            }
        } catch {
            // Expected: revoke fails because tx is already executed
        }
    }

    function didReentrancyGuardBlock() external view returns (bool) {
        return reentrancyBlocked;
    }
}
