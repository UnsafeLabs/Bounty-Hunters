// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function confirmTransaction(uint256 txId) external;
    function revokeConfirmation(uint256 txId) external;
}

contract MultiSigRevokeTarget {
    IMultiSigWallet public wallet;
    uint256 public transactionId;
    bool public callbackReached;

    function setWallet(address walletAddress) external {
        require(address(wallet) == address(0), "Wallet set");
        wallet = IMultiSigWallet(walletAddress);
    }

    function setTransactionId(uint256 txId) external {
        transactionId = txId;
    }

    function confirmTransaction(uint256 txId) external {
        wallet.confirmTransaction(txId);
    }

    function revokeConfirmation(uint256 txId) external {
        wallet.revokeConfirmation(txId);
    }

    function revokeDuringExecution() external {
        callbackReached = true;
        wallet.revokeConfirmation(transactionId);
    }
}
