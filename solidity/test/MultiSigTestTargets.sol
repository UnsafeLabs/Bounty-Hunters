// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function confirmTransaction(uint256 txId) external;
    function revokeConfirmation(uint256 txId) external;
}

contract RevocationCallbackOwner {
    IMultiSigWallet public wallet;

    function setWallet(address wallet_) external {
        wallet = IMultiSigWallet(wallet_);
    }

    function confirm(uint256 txId) external {
        wallet.confirmTransaction(txId);
    }

    function tryRevoke(uint256 txId) external {
        wallet.revokeConfirmation(txId);
    }
}
