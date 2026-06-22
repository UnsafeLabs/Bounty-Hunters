// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

/// @title Malicious target that tries to revoke confirmation during execution callback
contract ReentrantAttacker {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    bool public attacked;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function setTarget(uint256 _txId) external {
        targetTxId = _txId;
    }

    /// @notice Called by the wallet during executeTransaction — attempts reentrancy
    receive() external payable {
        if (!attacked) {
            attacked = true;
            // Try to revoke the confirmation of owner1 during the callback
            // This should fail due to nonReentrant guard
            try wallet.revokeConfirmation(targetTxId) {} catch {}
        }
    }
}

/// @title MultiSigWalletTest - Foundry tests for MultiSigWallet race condition fix
contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    ReentrantAttacker public attacker;

    address public owner1 = address(0xA);
    address public owner2 = address(0xB);
    address public owner3 = address(0xC);
    address public nonOwner = address(0xD);
    uint256 public constant REQUIRED = 2;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    /// @dev Helper to check if a transaction is executed (public getter returns tuple)
    function _isExecuted(uint256 txId) internal view returns (bool) {
        (, , , bool executed) = wallet.transactions(txId);
        return executed;
    }

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        wallet = new MultiSigWallet(owners, REQUIRED);

        // Fund the wallet
        vm.deal(address(wallet), 10 ether);

        // Fund owners for gas
        vm.deal(owner1, 1 ether);
        vm.deal(owner2, 1 ether);
        vm.deal(owner3, 1 ether);
    }

    // =============================================
    // Submit transaction
    // =============================================

    function test_submitTransaction_basic() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        assertEq(txId, 0, "First txId should be 0");
        assertEq(wallet.transactionCount(), 1, "Transaction count should be 1");
    }

    function test_submitTransaction_emits_event() public {
        vm.prank(owner1);
        vm.expectEmit(true, false, false, false);
        emit Submitted(0);
        wallet.submitTransaction(address(0x1), 1 ether, "");
    }

    function test_submitTransaction_non_owner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(0x1), 1 ether, "");
    }

    function test_submitTransaction_zero_address_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    // =============================================
    // Confirm transaction
    // =============================================

    function test_confirmTransaction_basic() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        assertTrue(wallet.confirmations(txId, owner1), "Should be confirmed");
    }

    function test_confirmTransaction_emits_event() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        vm.expectEmit(true, true, false, false);
        emit Confirmed(txId, owner1);
        wallet.confirmTransaction(txId);
    }

    function test_confirmTransaction_already_executed_reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner3);
        vm.expectRevert("Already executed");
        wallet.confirmTransaction(txId);
    }

    function test_confirmTransaction_already_confirmed_reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
    }

    // =============================================
    // Revoke confirmation
    // =============================================

    function test_revokeConfirmation_basic() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        assertFalse(wallet.confirmations(txId, owner1), "Should be revoked");
    }

    function test_revokeConfirmation_emits_event() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectEmit(true, true, false, false);
        emit Revoked(txId, owner1);
        wallet.revokeConfirmation(txId);
    }

    function test_revokeConfirmation_already_executed_reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.revokeConfirmation(txId);
    }

    function test_revokeConfirmation_not_confirmed_reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        vm.expectRevert("Not confirmed");
        wallet.revokeConfirmation(txId);
    }

    // =============================================
    // Execute transaction
    // =============================================

    function test_executeTransaction_basic() public {
        address payable recipient = payable(address(0x1));
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 balanceBefore = recipient.balance;
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(_isExecuted(txId), "Should be executed");
        assertEq(recipient.balance - balanceBefore, 1 ether, "Should receive ETH");
    }

    function test_executeTransaction_emits_event() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectEmit(true, false, false, false);
        emit Executed(txId);
        wallet.executeTransaction(txId);
    }

    function test_executeTransaction_already_executed_reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    function test_executeTransaction_not_enough_confirmations_reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    // =============================================
    // CRITICAL: Confirmation revocation during callback (reentrancy)
    // =============================================

    function test_reentrancy_cannot_revoke_during_execution() public {
        // Deploy attacker contract
        attacker = new ReentrantAttacker(address(wallet));

        // Submit a transaction to the attacker (which will receive ETH and try reentrancy)
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(attacker), 1 ether, "");

        attacker.setTarget(txId);

        // Two owners confirm
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Execute — the attacker's receive() will try to revoke confirmations
        // but the nonReentrant guard should prevent it
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // The transaction should still be marked as executed
        assertTrue(_isExecuted(txId), "Transaction should be executed");
        assertTrue(attacker.attacked(), "Attacker should have attempted reentrancy");
    }

    // =============================================
    // CRITICAL: Front-running revocation prevention via timestamp-based check
    // =============================================

    function test_front_running_revocation_prevented() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        // Both owners confirm
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Simulate a revocation happening after the confirmation
        vm.warp(block.timestamp + 1);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // Now try to execute — should fail because the confirmation count is below required
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_confirmation_snapshot_at_point_in_time() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        // Both confirm at time T
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        uint256 snapshotTime = block.timestamp;

        // At the snapshot time, should have 2 confirmations
        assertEq(wallet.getConfirmationCountAt(txId, snapshotTime), 2, "Should have 2 confirmations at snapshot");

        // Revoke at T+1
        vm.warp(block.timestamp + 1);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // Current count should be 1
        assertEq(wallet.getConfirmationCount(txId), 1, "Current count should be 1");

        // But the snapshot should still show 2
        assertEq(wallet.getConfirmationCountAt(txId, snapshotTime), 2, "Snapshot should still show 2");
    }

    // =============================================
    // Zero-address rejection
    // =============================================

    function test_zero_address_tx_rejected() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 0, "");
    }

    // =============================================
    // Gas cost check: ETH transfer should be under 100k gas
    // =============================================

    function test_executeTransaction_gas_under_100k() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        uint256 gasBefore = gasleft();
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasBefore - gasleft();

        // The acceptance criteria says under 100k gas for simple ETH transfer
        assertLt(gasUsed, 100_000, "Gas should be under 100k for simple ETH transfer");
    }

    // =============================================
    // Full multi-sig flow: submit -> confirm -> execute -> revoke
    // =============================================

    function test_full_multisig_flow() public {
        // Submit
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        // Confirm by owner1
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        assertTrue(wallet.confirmations(txId, owner1), "owner1 should be confirmed");

        // Confirm by owner2
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        assertTrue(wallet.confirmations(txId, owner2), "owner2 should be confirmed");

        // Check confirmation count
        assertEq(wallet.getConfirmationCount(txId), 2, "Should have 2 confirmations");

        // Execute
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        assertTrue(_isExecuted(txId), "Should be executed");

        // Try to revoke after execution (should fail)
        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.revokeConfirmation(txId);
    }

    function test_revoke_and_reconfirm_flow() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        // Confirm and then revoke
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        assertFalse(wallet.confirmations(txId, owner1), "Should be revoked");

        // Re-confirm
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        assertTrue(wallet.confirmations(txId, owner1), "Should be re-confirmed");

        // Also check timestamp was reset properly
        assertEq(wallet.confirmationTimestamp(txId, owner1), block.timestamp, "Timestamp should be current");
    }

    // =============================================
    // Edge cases
    // =============================================

    function test_constructor_zero_owners_reverts() public {
        address[] memory owners = new address[](0);
        vm.expectRevert("No owners");
        new MultiSigWallet(owners, 1);
    }

    function test_constructor_zero_required_reverts() public {
        address[] memory owners = new address[](1);
        owners[0] = owner1;
        vm.expectRevert("Invalid required");
        new MultiSigWallet(owners, 0);
    }

    function test_constructor_required_exceeds_owners_reverts() public {
        address[] memory owners = new address[](1);
        owners[0] = owner1;
        vm.expectRevert("Invalid required");
        new MultiSigWallet(owners, 2);
    }

    function test_execute_with_three_confirmations() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner3);
        wallet.confirmTransaction(txId);

        assertEq(wallet.getConfirmationCount(txId), 3, "Should have 3 confirmations");

        vm.prank(owner1);
        wallet.executeTransaction(txId);
        assertTrue(_isExecuted(txId), "Should be executed");
    }
}
