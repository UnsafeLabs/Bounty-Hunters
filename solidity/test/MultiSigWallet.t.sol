// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

// ─────────────────────────────────────────────
// Malicious contract: tries to re-enter executeTransaction during callback
// ─────────────────────────────────────────────
contract MaliciousReenterExecute {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    bool public reenterAttempted;
    bool public reenterSucceeded;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function setTargetTxId(uint256 _txId) external {
        targetTxId = _txId;
    }

    receive() external payable {
        if (!reenterAttempted) {
            reenterAttempted = true;
            try wallet.executeTransaction(targetTxId) {
                reenterSucceeded = true;
            } catch {
                reenterSucceeded = false;
            }
        }
    }
}

// ─────────────────────────────────────────────
// Malicious contract: tries to revoke confirmation during execution callback
// ─────────────────────────────────────────────
contract MaliciousRevokeCallback {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    bool public revokeAttempted;
    bool public revokeSucceeded;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function setTargetTxId(uint256 _txId) external {
        targetTxId = _txId;
    }

    receive() external payable {
        revokeAttempted = true;
        try wallet.revokeConfirmation(targetTxId) {
            revokeSucceeded = true;
        } catch {
            revokeSucceeded = false;
        }
    }
}

// ─────────────────────────────────────────────
// Simple target contract for execution tests
// ─────────────────────────────────────────────
contract TargetContract {
    bool public called;
    uint256 public callCount;

    function noArgs() external {
        called = true;
        callCount++;
    }

    receive() external payable {
        called = true;
        callCount++;
    }
}

// ─────────────────────────────────────────────
// Reverting target for failure tests
// ─────────────────────────────────────────────
contract RevertingTarget {
    receive() external payable {
        revert("I always revert");
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    TargetContract public target;

    address public owner1;
    address public owner2;
    address public owner3;
    address public nonOwner;

    uint256 constant REQUIRED = 2;

    function setUp() public {
        owner1 = makeAddr("owner1");
        owner2 = makeAddr("owner2");
        owner3 = makeAddr("owner3");
        nonOwner = makeAddr("nonOwner");

        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;

        wallet = new MultiSigWallet(owners, REQUIRED);
        target = new TargetContract();
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────

    function _submitTx(address to, uint256 value, bytes memory data) internal returns (uint256) {
        vm.prank(owner1);
        return wallet.submitTransaction(to, value, data);
    }

    function _confirmTx(uint256 txId, address owner) internal {
        vm.prank(owner);
        wallet.confirmTransaction(txId);
    }

    function _submitAndConfirm(address to, uint256 value, bytes memory data) internal returns (uint256) {
        uint256 txId = _submitTx(to, value, data);
        _confirmTx(txId, owner1);
        return txId;
    }

    /// @dev Confirms with enough owners, then rolls to next block so isConfirmedAtBlock passes
    function _confirmAndRoll(uint256 txId) internal {
        _confirmTx(txId, owner1);
        _confirmTx(txId, owner2);
        vm.roll(block.number + 1);
    }

    // ═══════════════════════════════════════════
    // ZERO-ADDRESS REJECTION
    // ═══════════════════════════════════════════

    function test_submitTransaction_zeroAddress_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Cannot send to zero address");
        wallet.submitTransaction(address(0), 0, "");
    }

    function test_submitTransaction_zeroAddress_withValue_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Cannot send to zero address");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    function test_submitTransaction_zeroAddress_withData_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Cannot send to zero address");
        wallet.submitTransaction(address(0), 0, abi.encodeWithSelector(TargetContract.noArgs.selector));
    }

    // ═══════════════════════════════════════════
    // CONFIRMATION REVOCATION DURING CALLBACK
    // ═══════════════════════════════════════════

    function test_reentrancy_revokeDuringCallback_prevented() public {
        // Deploy malicious contract as a target
        MaliciousRevokeCallback attacker = new MaliciousRevokeCallback(address(wallet));

        // Fund wallet
        vm.deal(address(wallet), 1 ether);

        // Submit tx to malicious contract
        uint256 txId = _submitAndConfirm(address(attacker), 1 ether, "");
        _confirmTx(txId, owner2);

        // Set target so the callback knows which tx to revoke
        attacker.setTargetTxId(txId);

        // Roll forward so isConfirmedAtBlock check passes
        vm.roll(block.number + 1);

        // Execute — the attacker's receive() will try to revoke
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Verify the revoke attempt was blocked (tx already executed)
        assertFalse(attacker.revokeSucceeded(), "Revoke during callback should fail");
    }

    function test_reentrancy_reenterExecute_prevented() public {
        MaliciousReenterExecute attacker = new MaliciousReenterExecute(address(wallet));

        vm.deal(address(wallet), 1 ether);

        uint256 txId = _submitAndConfirm(address(attacker), 1 ether, "");
        _confirmTx(txId, owner2);

        attacker.setTargetTxId(txId);

        vm.roll(block.number + 1);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Verify reentrancy was blocked
        assertFalse(attacker.reenterSucceeded(), "Re-entrancy should be blocked");
    }

    // ═══════════════════════════════════════════
    // FRONT-RUNNING REVOCATION PROTECTION
    // ═══════════════════════════════════════════

    function test_frontRunning_revocationInSameBlock_prevented() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // Roll forward so confirmations are in a prior block
        vm.roll(block.number + 1);

        // Front-runner revokes in the same block as execution attempt
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // Now execution should fail because isConfirmedAtBlock(txId, block.number - 1)
        // still sees the revocation in the previous block? No — the revoke is in the current block.
        // isConfirmedAtBlock checks block.number - 1, and the revoke happened in block.number,
        // so the previous block still has the confirmation.
        // But getConfirmationCount is now below required, so execution fails.
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_frontRunning_revocationInPreviousBlock_prevented() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // Confirmations at block N
        uint256 confirmBlock = block.number;

        // Roll forward one block — revoke in block N+1
        vm.roll(confirmBlock + 1);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // Try to execute in block N+1
        // isConfirmedAtBlock(txId, block.number - 1) = isConfirmedAtBlock(txId, N)
        // At block N: owner2 confirmed (revocationBlock is N+1 > N, so not revoked at block N)
        // So isConfirmedAtBlock should return TRUE at block N
        // But getConfirmationCount is below required
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_isConfirmedAtBlock_returnsTrueWhenConfirmationsWereValid() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        uint256 confirmBlock = block.number;

        // At the confirmation block, should be confirmed
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmBlock));
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmBlock + 1));
    }

    function test_isConfirmedAtBlock_returnsFalseBeforeConfirmation() public {
        uint256 txId = _submitTx(address(target), 0, "");

        // Before any confirmations
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number));

        // Confirm in this block
        _confirmTx(txId, owner1);
        // Still not enough (need 2)
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number));
    }

    function test_isConfirmedAtBlock_returnsFalseAfterRevocation() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        uint256 confirmBlock = block.number;

        // Confirmed at confirmBlock
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmBlock));

        // Roll forward and revoke
        vm.roll(confirmBlock + 1);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // At the block after revocation, should NOT be confirmed
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number));
        // At the original confirmation block, should still be confirmed
        // (revocation happened later)
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmBlock));
    }

    function test_sameBlockConfirmAndExecute_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // Try to execute in the same block as confirmations
        // isConfirmedAtBlock(txId, block.number - 1) should return false
        // because confirmations were made in the current block
        vm.prank(owner1);
        vm.expectRevert("Confirmations not stable at previous block");
        wallet.executeTransaction(txId);
    }

    // ═══════════════════════════════════════════
    // HAPPY PATH: SUBMIT, CONFIRM, EXECUTE, REVOKE
    // ═══════════════════════════════════════════

    function test_submitTransaction_succeeds() public {
        uint256 txId = _submitTx(address(target), 0, "");
        assertEq(txId, 0);
        assertEq(wallet.transactionCount(), 1);
    }

    function test_confirmTransaction_succeeds() public {
        uint256 txId = _submitTx(address(target), 0, "");
        _confirmTx(txId, owner1);
        assertTrue(wallet.confirmations(txId, owner1));
        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    function test_executeTransaction_succeeds() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // Roll to next block for isConfirmedAtBlock check
        vm.roll(block.number + 1);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (,,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);
        assertTrue(target.called());
    }

    function test_executeTransaction_withETH_succeeds() public {
        vm.deal(address(wallet), 1 ether);

        uint256 txId = _submitAndConfirm(nonOwner, 1 ether, "");
        _confirmTx(txId, owner2);

        vm.roll(block.number + 1);

        uint256 balBefore = nonOwner.balance;
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        assertEq(nonOwner.balance, balBefore + 1 ether);
    }

    function test_revokeConfirmation_succeeds() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        assertFalse(wallet.confirmations(txId, owner2));
        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    function test_fullWorkflow_submitConfirmRevokeReconfirmExecute() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");

        // owner2 confirms
        _confirmTx(txId, owner2);

        // owner2 revokes
        vm.roll(block.number + 1);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);
        assertEq(wallet.getConfirmationCount(txId), 1);

        // Cannot execute with only 1 confirmation
        vm.roll(block.number + 1);
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);

        // owner2 reconfirms
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        assertEq(wallet.getConfirmationCount(txId), 2);

        // Roll so isConfirmedAtBlock passes
        vm.roll(block.number + 1);

        // Now execution succeeds
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        assertTrue(target.called());
    }

    function test_executeTransaction_alreadyExecuted_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        vm.roll(block.number + 1);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner2);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    // ═══════════════════════════════════════════
    // ACCESS CONTROL
    // ═══════════════════════════════════════════

    function test_nonOwnerCannotSubmit() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(target), 0, "");
    }

    function test_nonOwnerCannotConfirm() public {
        uint256 txId = _submitTx(address(target), 0, "");
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    function test_nonOwnerCannotRevoke() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.revokeConfirmation(txId);
    }

    function test_nonOwnerCannotExecute() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);
        vm.roll(block.number + 1);
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.executeTransaction(txId);
    }

    // ═══════════════════════════════════════════
    // CONSTRUCTOR VALIDATION
    // ═══════════════════════════════════════════

    function test_constructor_zeroAddressOwner_reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = address(0);
        owners[1] = owner2;
        vm.expectRevert("Zero address owner");
        new MultiSigWallet(owners, 1);
    }

    function test_constructor_duplicateOwner_reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = owner1;
        vm.expectRevert("Duplicate owner");
        new MultiSigWallet(owners, 1);
    }

    function test_constructor_noOwners_reverts() public {
        address[] memory owners = new address[](0);
        vm.expectRevert("No owners");
        new MultiSigWallet(owners, 1);
    }

    function test_constructor_invalidRequired_reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = owner2;
        vm.expectRevert("Invalid required");
        new MultiSigWallet(owners, 3);
    }

    // ═══════════════════════════════════════════
    // CONFIRM/REVOKE EDGE CASES
    // ═══════════════════════════════════════════

    function test_confirmAlreadyConfirmed_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        vm.prank(owner1);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
    }

    function test_confirmAfterExecution_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);
        vm.roll(block.number + 1);
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner3);
        vm.expectRevert("Already executed");
        wallet.confirmTransaction(txId);
    }

    function test_revokeNotConfirmed_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        vm.prank(owner2);
        vm.expectRevert("Not confirmed");
        wallet.revokeConfirmation(txId);
    }

    function test_revokeAfterExecution_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);
        vm.roll(block.number + 1);
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.revokeConfirmation(txId);
    }

    function test_confirmNonExistentTx_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Transaction does not exist");
        wallet.confirmTransaction(99);
    }

    // ═══════════════════════════════════════════
    // RECEIVE ETHER
    // ═══════════════════════════════════════════

    function test_receiveEther() public {
        vm.deal(address(this), 10 ether);
        (bool success,) = address(wallet).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(wallet).balance, 1 ether);
    }

    // ═══════════════════════════════════════════
    // 1-of-1 WALLET EDGE CASE
    // ═══════════════════════════════════════════

    function test_oneOfOneWallet() public {
        address[] memory owners = new address[](1);
        owners[0] = owner1;
        MultiSigWallet oneOfOne = new MultiSigWallet(owners, 1);

        vm.prank(owner1);
        uint256 txId = oneOfOne.submitTransaction(address(target), 0, "");
        vm.prank(owner1);
        oneOfOne.confirmTransaction(txId);

        vm.roll(block.number + 1);

        vm.prank(owner1);
        oneOfOne.executeTransaction(txId);
        assertTrue(target.called());
    }

    // ═══════════════════════════════════════════
    // EXECUTION FAILURE
    // ═══════════════════════════════════════════

    function test_executionFailed_reverts() public {
        RevertingTarget revertTarget = new RevertingTarget();
        uint256 txId = _submitAndConfirm(address(revertTarget), 0, "");
        _confirmTx(txId, owner2);

        vm.roll(block.number + 1);

        vm.prank(owner1);
        vm.expectRevert("Execution failed");
        wallet.executeTransaction(txId);
    }
}
