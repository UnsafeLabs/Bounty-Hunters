// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function confirmTransaction(uint256 txId) external;
    function revokeConfirmation(uint256 txId) external;
}

contract RevokingMultiSigOwner {
    IMultiSigWallet public wallet;
    uint256 public txIdToRevoke;
    bool public revokeDuringCallback;
    uint256 public callbacks;

    function setWallet(address _wallet) external {
        wallet = IMultiSigWallet(_wallet);
    }

    function confirm(uint256 txId) external {
        wallet.confirmTransaction(txId);
    }

    function setRevokeDuringCallback(uint256 txId, bool enabled) external {
        txIdToRevoke = txId;
        revokeDuringCallback = enabled;
    }

    function callback() external {
        callbacks += 1;
        if (revokeDuringCallback) {
            wallet.revokeConfirmation(txIdToRevoke);
        }
    }

    receive() external payable {
        callbacks += 1;
        if (revokeDuringCallback) {
            wallet.revokeConfirmation(txIdToRevoke);
        }
    }
}
