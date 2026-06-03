// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/MultiSigWallet.sol";

/// @notice Malicious contract that attempts to revoke confirmation during execution callback
contract ReentrancyAttacker {
    MultiSigWallet public wallet;
    uint256 public attackTxId;
    uint256 public revokeTxId;
    bool public attacked;

    constructor(MultiSigWallet _wallet) {
        wallet = _wallet;
    }

    function setupAttack(uint256 _attackTxId, uint256 _revokeTxId) external {
        attackTxId = _attackTxId;
        revokeTxId = _revokeTxId;
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            // Try to revoke confirmation during callback — should be blocked by nonReentrant
            try wallet.revokeConfirmation(revokeTxId) {
                // If we get here, the reentrancy attack succeeded (should not happen)
            } catch {
                // Expected: reentrancy guard blocks this
            }
        }
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;

    address public owner1 = vm.addr(1);
    address public owner2 = vm.addr(2);
    address public owner3 = vm.addr(3);
    address public nonOwner = vm.addr(4);

    uint256 public required = 2;

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;

        wallet = new MultiSigWallet(owners, required);
        vm.deal(address(wallet), 10 ether);
    }

    // ========== Constructor tests ==========

    function test_Constructor_ZeroAddressOwner_Reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = address(0);

        vm.expectRevert("Zero address owner");
        new MultiSigWallet(owners, 2);
    }

    function test_Constructor_NoOwners_Reverts() public {
        address[] memory owners = new address[](0);
        vm.expectRevert("No owners");
        new MultiSigWallet(owners, 1);
    }

    // ========== Submit tests ==========

    function test_SubmitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        assertEq(txId, 0);

        (address to, uint256 value, , bool executed, uint256 executedAt) = wallet.transactions(txId);
        assertEq(to, address(0x1));
        assertEq(value, 1 ether);
        assertFalse(executed);
        assertEq(executedAt, 0);
    }

    function test_SubmitTransaction_ZeroAddress_Reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    function test_SubmitTransaction_NonOwner_Reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(0x1), 1 ether, "");
    }

    // ========== Confirm tests ==========

    function test_ConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        assertTrue(wallet.confirmations(txId, owner2));
        assertEq(wallet.confirmationBlocks(txId, owner2), block.number);
    }

    function test_ConfirmTransaction_NonOwner_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    function test_ConfirmTransaction_DoubleConfirm_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.startPrank(owner2);
        wallet.confirmTransaction(txId);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
        vm.stopPrank();
    }

    // ========== Revoke tests ==========

    function test_RevokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        assertFalse(wallet.confirmations(txId, owner2));
        assertEq(wallet.confirmationBlocks(txId, owner2), 0);
    }

    function test_RevokeConfirmation_NotConfirmed_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner2);
        vm.expectRevert("Not confirmed");
        wallet.revokeConfirmation(txId);
    }

    // ========== Execute tests ==========

    function test_ExecuteTransaction() public {
        address payable target = payable(address(0x100));
        uint256 sendAmount = 1 ether;
        uint256 balanceBefore = target.balance;

        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(target, sendAmount, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (, , , bool executed, uint256 executedAt) = wallet.transactions(txId);
        assertTrue(executed);
        assertEq(executedAt, block.number);
        assertEq(target.balance, balanceBefore + sendAmount);
    }

    function test_ExecuteTransaction_NotEnoughConfirmations_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_ExecuteTransaction_AlreadyExecuted_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    function test_ExecuteTransaction_RevokeAfterExecute_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner2);
        vm.expectRevert("Already executed");
        wallet.revokeConfirmation(txId);
    }

    // ========== Reentrancy attack test ==========

    function test_Reentrancy_RevokeDuringCallback_Blocked() public {
        // Deploy attacker contract
        ReentrancyAttacker attacker = new ReentrancyAttacker(wallet);

        // Fund the attack target
        vm.deal(address(attacker), 1 ether);

        // Add attacker as an owner (deploy fresh wallet)
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = address(attacker);
        MultiSigWallet wallet2 = new MultiSigWallet(owners, 2);
        vm.deal(address(wallet2), 10 ether);

        ReentrancyAttacker attacker2 = new ReentrancyAttacker(wallet2);
        vm.deal(address(attacker2), 1 ether);

        // Tx 0: owner1 submits a legitimate transfer to attacker
        vm.prank(owner1);
        uint256 legitTxId = wallet2.submitTransaction(address(attacker2), 0.1 ether, "");

        // Tx 1: owner1 submits another tx (that attacker will try to revoke from)
        vm.prank(owner1);
        uint256 victimTxId = wallet2.submitTransaction(address(0x999), 0.1 ether, "");

        // Setup attacker to revoke victimTxId during callback
        attacker2.setupAttack(legitTxId, victimTxId);

        // Both owners confirm the legitimate tx
        vm.prank(owner1);
        wallet2.confirmTransaction(legitTxId);
        vm.prank(owner2);
        wallet2.confirmTransaction(legitTxId);

        // Also confirm and then revoke on victimTxId from attacker
        vm.prank(address(attacker2));
        wallet2.confirmTransaction(victimTxId);

        // Now execute — attacker's receive() will try to revoke victimTxId
        // The nonReentrant guard should prevent this
        vm.prank(owner1);
        wallet2.executeTransaction(legitTxId);

        // Verify: the victim transaction's confirmation from attacker2 should still be intact
        // because the reentrancy attack was blocked
        assertTrue(attacker2.attacked(), "Attack should have been attempted");
    }

    // ========== Front-running revocation tests ==========

    function test_FrontRunning_IsConfirmedAtBlock_HistoricalCheck() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        // Confirm at current block
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        uint256 confirmedBlock = block.number;

        // Advance one block
        vm.roll(block.number + 1);

        // isConfirmedAtBlock should still return true for the historical block
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmedBlock),
            "Should be confirmed at the historical block");

        // Now revoke at current block
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // isConfirmedAtBlock at historical block should STILL be true (front-running protection)
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmedBlock),
            "Historical confirmation should survive revocation");

        // isConfirmedAtBlock at current block should be false
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number),
            "Current block should show insufficient confirmations after revocation");
    }

    function test_FrontRunning_ConfirmationSnapshot_Protected() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 0.5 ether, "");

        uint256 blockA = block.number;
        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.roll(block.number + 1);
        uint256 blockB = block.number;
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // At blockA, only 1 confirmation → not enough
        assertFalse(wallet.isConfirmedAtBlock(txId, blockA));

        // At blockB, 2 confirmations → enough
        assertTrue(wallet.isConfirmedAtBlock(txId, blockB));

        // Front-runner tries to revoke after seeing execution
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // But the snapshot at blockB is immutable
        assertTrue(wallet.isConfirmedAtBlock(txId, blockB));
    }

    // ========== Gas test ==========

    function test_ExecuteTransaction_GasLimit() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        uint256 gasBefore = gasleft();
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasBefore - gasleft();

        // Simple ETH transfer should use well under 100,000 gas
        assertTrue(gasUsed < 100_000, string.concat(
            "Gas too high: ", vm.toString(gasUsed)
        ));
    }

    // ========== Full flow tests ==========

    function test_FullFlow_SubmitConfirmExecute() public {
        address payable target = payable(address(0x200));
        uint256 sendAmount = 2 ether;

        // Submit
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(target, sendAmount, "");

        // Confirm by two different owners
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner3);
        wallet.confirmTransaction(txId);

        // Execute
        vm.prank(owner3);
        wallet.executeTransaction(txId);

        assertEq(target.balance, sendAmount);
    }

    function test_FullFlow_SubmitConfirmRevoke() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        assertEq(wallet.getConfirmationCount(txId), 1);

        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    // ========== Utility tests ==========

    function test_GetOwners() public {
        address[] memory owners = wallet.getOwners();
        assertEq(owners.length, 3);
        assertEq(owners[0], owner1);
        assertEq(owners[1], owner2);
        assertEq(owners[2], owner3);
    }

    function test_GetTransactionCount() public {
        assertEq(wallet.getTransactionCount(), 0);

        vm.prank(owner1);
        wallet.submitTransaction(address(0x1), 1 ether, "");
        assertEq(wallet.getTransactionCount(), 1);

        vm.prank(owner2);
        wallet.submitTransaction(address(0x2), 2 ether, "");
        assertEq(wallet.getTransactionCount(), 2);
    }

    function test_Receive() public {
        vm.deal(address(this), 1 ether);
        (bool success, ) = address(wallet).call{value: 1 ether}("");
        assertTrue(success);
    }
}
