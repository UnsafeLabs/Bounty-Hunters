// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function revokeConfirmation(uint256 txId) external;
}

/**
 * @title ReentrancyAttacker
 * @notice Malicious contract that tries to revoke a multi-sig confirmation
 *         during the execution callback to test reentrancy protection.
 */
contract ReentrancyAttacker {
    IMultiSigWallet public wallet;

    constructor(address _wallet) {
        wallet = IMultiSigWallet(_wallet);
    }

    /// @notice Triggers a receive() callback with a revoke attempt
    function attack(uint256 amount, uint256 txId) external payable {
        // The MultiSigWallet will call this contract via executeTransaction
        // When ETH is received, receive() automatically fires
        // Our receive() tries to revoke the confirmation
    }

    receive() external payable {
        // Try to revoke the confirmation during execution callback
        // This should be blocked by nonReentrant
        (bool success, ) = address(wallet).call(
            abi.encodeWithSignature("revokeConfirmation(uint256)", 0)
        );
        // Even if successful (it shouldn't be), continue execution
        // to test that the MultiSigWallet's nonReentrant works
    }
}
