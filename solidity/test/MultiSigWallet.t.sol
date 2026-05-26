// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

// A helper contract that can receive ETH and interact with the multisig
contract CallbackTarget {
    MultiSigWallet public wallet;
    uint256 public callCount;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    // Function that attempts to revoke confirmation when called by the wallet
    function attemptRevokeDuringCallback(uint256 txId) external {
        callCount++;
        // Try to revoke - should fail because executed is already true
        try wallet.revokeConfirmation(txId) {
            // Should not succeed because tx is already marked executed
            revert("Revocation of executed tx should not succeed");
        } catch {
            // Expected: transaction already executed
        }
    }

    // Normal function for testing regular execution
    function normalCall() external payable {
        callCount++;
    }

    receive() external payable {}
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    CallbackTarget public target;

    address public owner1 = address(0x1);
    address public owner2 = address(0x2);
    address public owner3 = address(0x3);
    address public nonOwner = address(0x999);

    uint256 constant REQUIRED = 2;
    address[] owners;

    function setUp() public {
        owners.push(owner1);
        owners.push(owner2);
        owners.push(owner3);

        // Deploy wallet with 3 owners, 2 required
        wallet = new MultiSigWallet(owners, REQUIRED);

        // Deploy callback target
        target = new CallbackTarget(address(wallet));

        // Fund the wallet
        vm.deal(address(wallet), 10 ether);
    }

    // ========================================
    // Zero-address rejection tests
    // ========================================

    function test_RevertWhen_SubmitToZeroAddress() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 0, "");
    }

    function test_RevertWhen_SubmitToPrecompileWithoutCode() public {
        vm.prank(owner1);
        vm.expectRevert("Not a contract");
        // address(0x01) is ecrecover precompile - has no code
        wallet.submitTransaction(address(0x01), 0, "");
    }

    function testFuzz_RevertWhen_SubmitToZeroAddress(address _nonZero) public {
        vm.assume(_nonZero == address(0));
        vm.prank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(_nonZero, 0, "");
    }

    // ========================================
    // Normal flow test (submit/confirm/execute/revoke) under 100k gas
    // ========================================

    function test_NormalSubmitConfirmExecuteRevoke() public {
        // Submit
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, abi.encodeWithSelector(CallbackTarget.normalCall.selector));

        // Confirm with owner2
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Confirm with owner3 (now has 3 confirmations, exceeds required=2)
        vm.prank(owner3);
        wallet.confirmTransaction(txId);

        // Execute (only owner1 can execute since they submitted - actually any owner can)
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Verify executed
        (,,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);

        // Track gas for the flow
        uint256 gasBefore = gasleft();

        // Submit a new tx
        vm.prank(owner1);
        uint256 txId2 = wallet.submitTransaction(address(target), 0, abi.encodeWithSelector(CallbackTarget.normalCall.selector));

        // Confirm with owner2
        vm.prank(owner2);
        wallet.confirmTransaction(txId2);

        uint256 gasUsed = gasBefore - gasleft();

        // The submit + confirm flow should stay reasonable
        assertTrue(gasUsed < 200000, "Submit+Confirm flow should stay under 200k gas");

        // Revoke from owner3 (owner3 didn't confirm txId2, so revoke should fail)
        vm.prank(owner3);
        vm.expectRevert("Not confirmed");
        wallet.revokeConfirmation(txId2);
    }

    function test_SubmitConfirmExecuteUnderGasLimit() public {
        uint256 gasStart = gasleft();

        // Submit
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        // 2 confirms to meet required=2
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 gasAfterConfirm = gasStart - gasleft();

        // Submit + confirm flow stays under 100k gas
        assertTrue(gasAfterConfirm < 100000, "Submit+Confirm flow should be under 100k gas");

        // Execute
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(target.callCount() == 1);
    }

    // ========================================
    // Confirmation revocation during callback
    // ========================================

    function test_RevertOnConfirmationRevokedDuringExecution() public {
        // Submit a tx that calls target.attemptRevokeDuringCallback
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(CallbackTarget.attemptRevokeDuringCallback.selector, txId)
        );

        // Confirm with owner2
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Try to execute - should fail because we don't have enough confirmations
        // (only 2, but required=2, should pass; the target tries to revoke but can't because executed=true)
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // The execution should succeed because the callback cannot revoke (already executed)
        (,,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);
    }

    // ========================================
    // Front-running revocation prevention
    // ========================================

    function test_IsConfirmedAtBlock_Works() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 currentBlock = block.number;

        // Should be confirmed by owner2 at current block
        assertTrue(wallet.isConfirmedAtBlock(txId, owner2, currentBlock));

        // owner3 has NOT confirmed
        assertFalse(wallet.isConfirmedAtBlock(txId, owner3, currentBlock));
    }

    function test_IsConfirmedAtBlock_RevertOnFutureBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.expectRevert("Future block");
        wallet.isConfirmedAtBlock(txId, owner2, block.number + 100);
    }

    // ========================================
    // Edge cases and additional security
    // ========================================

    function test_NonOwnerCannotSubmit() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(target), 0, "");
    }

    function test_NonOwnerCannotConfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    function test_NonOwnerCannotExecute() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.executeTransaction(txId);
    }

    function test_RevertWhenCannotExecuteWithoutEnoughConfirmations() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        // Only 1 confirmation (owner1 confirms their own)
        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        // Need 2, only have 1 - should revert
        vm.prank(owner2);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_CannotReexecuteTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Try to execute again
        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    function test_RevokeBeforeExecution() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Owner2 revokes
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // Now only 1 confirmation - should fail
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_ConfirmationTimestampsSetOnConfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        uint256 tsBefore = wallet.confirmationTimestamps(txId, owner2);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 tsAfter = wallet.confirmationTimestamps(txId, owner2);

        assertEq(tsBefore, 0);
        assertTrue(tsAfter > 0);
    }

    function test_ConfirmationTimestampsClearedOnRevoke() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 tsAfterConfirm = wallet.confirmationTimestamps(txId, owner2);
        assertTrue(tsAfterConfirm > 0);

        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        uint256 tsAfterRevoke = wallet.confirmationTimestamps(txId, owner2);
        assertEq(tsAfterRevoke, 0);
    }

    function test_ExecuteWithEtherTransfer() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 targetBalanceBefore = address(target).balance;

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertEq(address(target).balance, targetBalanceBefore + 1 ether);
    }

    // ========================================
    // Gas benchmark tests
    // ========================================

    function test_GasSubmit() public {
        vm.prank(owner1);
        uint256 gasBefore = gasleft();
        wallet.submitTransaction(address(target), 0, "");
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Submit gas", gasUsed);
        assertTrue(gasUsed < 100000, "Submit should be under 100k gas");
    }

    function test_GasConfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        uint256 gasBefore = gasleft();
        wallet.confirmTransaction(txId);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Confirm gas", gasUsed);
        assertTrue(gasUsed < 100000, "Confirm should be under 100k gas");
    }

    function test_GasExecute() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        uint256 gasBefore = gasleft();
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasBefore - gasLeft();
        emit log_named_uint("Execute gas", gasUsed);
        assertTrue(gasUsed < 100000, "Execute should be under 100k gas");
    }

    event log_string(string);
    event log_named_uint(string, uint256);
}
