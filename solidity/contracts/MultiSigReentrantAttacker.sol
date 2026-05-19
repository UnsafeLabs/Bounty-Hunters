// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MultiSigWallet.sol";

contract MultiSigReentrantAttacker {
    MultiSigWallet public immutable wallet;
    uint256 public immutable targetTxId;
    bool public attempted;

    constructor(MultiSigWallet _wallet, uint256 _targetTxId) {
        wallet = _wallet;
        targetTxId = _targetTxId;
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            wallet.revokeConfirmation(targetTxId);
        }
    }
}
