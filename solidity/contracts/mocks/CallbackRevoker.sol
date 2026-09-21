// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function revokeConfirmation(uint256 txId) external;
    function confirmTransaction(uint256 txId) external;
}

/// @dev Owner contract that tries to revoke its confirmation during the ETH callback.
contract CallbackRevoker {
    IMultiSigWallet public wallet;
    uint256 public txId;
    bool public armed;

    function setWallet(address wallet_) external {
        require(address(wallet) == address(0), "Wallet set");
        wallet = IMultiSigWallet(wallet_);
    }

    function arm(uint256 txId_) external {
        txId = txId_;
        armed = true;
    }

    function confirm() external {
        wallet.confirmTransaction(txId);
    }

    receive() external payable {
        if (armed) {
            armed = false;
            wallet.revokeConfirmation(txId);
        }
    }
}
