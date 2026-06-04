// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../MultiSigWallet.sol";

contract MultiSigCallbackRevoker {
    MultiSigWallet public wallet;
    uint256 public txId;
    bool public attemptRevoke;
    bool public revokeSucceeded;

    event RevokeAttempt(bool succeeded);

    function configure(MultiSigWallet _wallet, uint256 _txId) external {
        wallet = _wallet;
        txId = _txId;
    }

    function setAttemptRevoke(bool enabled) external {
        attemptRevoke = enabled;
    }

    function confirm(uint256 targetTxId) external {
        wallet.confirmTransaction(targetTxId);
    }

    function revoke(uint256 targetTxId) external {
        wallet.revokeConfirmation(targetTxId);
    }

    receive() external payable {
        if (!attemptRevoke) {
            return;
        }

        try wallet.revokeConfirmation(txId) {
            revokeSucceeded = true;
            emit RevokeAttempt(true);
        } catch {
            revokeSucceeded = false;
            emit RevokeAttempt(false);
        }
    }
}
