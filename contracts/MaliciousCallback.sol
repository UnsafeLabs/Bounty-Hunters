// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MaliciousCallback
 * @dev When called, this contract revokes its own confirmation on the provided
 * MultiSigWallet, simulating a re‑entrancy attack that tries to break the
 * execution flow.
 */
interface IMultiSigWallet {
    function revokeConfirmation(uint256 _txId) external;
}

contract MaliciousCallback {
    IMultiSigWallet public wallet;
    uint256 public targetTxId;

    constructor(address _wallet) {
        wallet = IMultiSigWallet(_wallet);
    }

    // The fallback is triggered by the wallet's external call.
    fallback() external payable {
        // Attempt to revoke the confirmation for the transaction that triggered this call.
        // The txId is known because the wallet passes it as part of the calldata; for the
        // test we set it manually after deployment.
        wallet.revokeConfirmation(targetTxId);
    }

    receive() external payable {}
}
