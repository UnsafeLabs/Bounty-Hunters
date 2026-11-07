// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

contract MockCallback {
    MultiSigWallet public wallet;
    bool public shouldRevoke;

    constructor(MultiSigWallet _wallet) {
        wallet = _wallet;
    }

    function setShouldRevoke(bool _shouldRevoke) external {
        shouldRevoke = _shouldRevoke;
    }

    receive() external payable {
        if (shouldRevoke && msg.sender == address(wallet)) {
            // Try to revoke confirmation during callback
            wallet.revokeConfirmation(0);
        }
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    address[] public owners;
    address public owner1;
    address public owner2;
    address public owner3;
    address public nonOwner;
    uint256 public required = 2;

    function setUp() public {
        owner1 = address(0x1);
        owner2 = address(0x2);
        owner3 = address(0x3);
        nonOwner = address(0x4);

        owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;

        wallet = new MultiSigWallet(owners, required);

        // Fund the wallet
        vm.deal(address(wallet), 100 ether);
        vm.deal(owner1, 10 ether);
        vm.deal(owner2, 10 ether);
        vm.deal(owner3, 10 ether);
    }

    function testSubmitTransactionRejectsZeroAddress() public {
        vm.prank(owner1);
        vm.expectRevert("Invalid recipient");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    function testSubmitTransactionRejectsNonContractWithData() public {
        address nonContract = address(0x123);
        
        vm.prank(owner1);
        vm.expectRevert("Target must be contract");
        wallet.submitTransaction(nonContract, 1 ether, "0x1234");
    }

    function testSubmitTransactionAllowsETHTransfer() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");
        
        assertEq(txId, 0);
        (address to, uint256 value, bytes memory data, bool executed, ) = wallet.transactions(0);
        assertEq(to, owner2);
        assertEq(value, 1 ether);
        assertEq(data.length, 0);
        assertFalse(executed);
    }

    function testConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        assertTrue(wallet.confirmations(txId, owner1).confirmed);
        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    function testRevokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        assertTrue(wallet.confirmations(txId, owner1).confirmed);

        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        assertFalse(wallet.confirmations(txId, owner1).confirmed);
        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    function testExecuteTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 balanceBefore = owner2.balance;

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        uint256 balanceAfter = owner2.balance;
        assertEq(balanceAfter - balanceBefore, 1 ether);

        (, , , bool executed, ) = wallet.transactions(txId);
        assertTrue(executed);
    }

    function testExecuteTransactionFailsWithInsufficientConfirmations() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function testExecuteTransactionFailsOnReplay() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

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

    function testConfirmationRevocationDuringCallback() public {
        // Deploy mock callback contract
        MockCallback callback = new MockCallback(wallet);
        
        // Add callback as owner for testing
        address[] memory newOwners = new address[](4);
        newOwners[0] = owner1;
        newOwners[1] = owner2;
        newOwners[2] = owner3;
        newOwners[3] = address(callback);
        
        MultiSigWallet wallet2 = new MultiSigWallet(newOwners, 2);
        vm.deal(address(wallet2), 100 ether);

        // Submit transaction to callback
        vm.prank(owner1);
        uint256 txId = wallet2.submitTransaction(address(callback), 1 ether, "");

        // Confirm from owner1 and owner2
        vm.prank(owner1);
        wallet2.confirmTransaction(txId);

        vm.prank(owner2);
        wallet2.confirmTransaction(txId);

        // Set callback to revoke confirmation during execution
        callback.setShouldRevoke(true);

        // Execute - should fail because confirmation is revoked during callback
        vm.prank(owner1);
        vm.expectRevert("Confirmations revoked");
        wallet2.executeTransaction(txId);
    }

    function testBlockLevelConfirmationCheck() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 confirmationBlock = block.number;

        // Check confirmation at current block
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmationBlock));

        // Revoke one confirmation
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);

        // Should no longer be confirmed at current block
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number));

        // But should still be confirmed at the old block
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmationBlock));
    }

    function testGetConfirmationCountAtBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

        uint256 block1 = block.number;

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        uint256 block2 = block.number;

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 block3 = block.number;

        // At block1: 0 confirmations
        assertEq(wallet.getConfirmationCountAtBlock(txId, block1), 0);

        // At block2: 1 confirmation
        assertEq(wallet.getConfirmationCountAtBlock(txId, block2), 1);

        // At block3: 2 confirmations
        assertEq(wallet.getConfirmationCountAtBlock(txId, block3), 2);

        // Current: 2 confirmations
        assertEq(wallet.getConfirmationCount(txId), 2);
    }

    function testReentrancyProtection() public {
        // Create a malicious contract that tries to reenter
        MaliciousReentry malicious = new MaliciousReentry(wallet);
        
        address[] memory newOwners = new address[](4);
        newOwners[0] = owner1;
        newOwners[1] = owner2;
        newOwners[2] = owner3;
        newOwners[3] = address(malicious);
        
        MultiSigWallet wallet2 = new MultiSigWallet(newOwners, 2);
        vm.deal(address(wallet2), 100 ether);

        vm.prank(owner1);
        uint256 txId = wallet2.submitTransaction(address(malicious), 1 ether, "");

        vm.prank(owner1);
        wallet2.confirmTransaction(txId);

        vm.prank(owner2);
        wallet2.confirmTransaction(txId);

        // Try to execute - malicious contract will try to reenter
        vm.prank(owner1);
        vm.expectRevert("Reentrant call");
        wallet2.executeTransaction(txId);
    }

    function testGasCostForSimpleTransfer() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 gasStart = gasleft();
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasStart - gasleft();

        // Gas cost should be under 100,000 for simple ETH transfer
        assertLt(gasUsed, 100000, "Gas cost exceeds 100,000");
    }

    function testMultipleTransactions() public {
        // Submit multiple transactions
        vm.startPrank(owner1);
        uint256 txId1 = wallet.submitTransaction(owner2, 1 ether, "");
        uint256 txId2 = wallet.submitTransaction(owner3, 2 ether, "");
        vm.stopPrank();

        // Confirm both
        vm.prank(owner1);
        wallet.confirmTransaction(txId1);
        vm.prank(owner2);
        wallet.confirmTransaction(txId1);

        vm.prank(owner1);
        wallet.confirmTransaction(txId2);
        vm.prank(owner2);
        wallet.confirmTransaction(txId2);

        // Execute both
        uint256 balance2Before = owner2.balance;
        uint256 balance3Before = owner3.balance;

        vm.prank(owner1);
        wallet.executeTransaction(txId1);

        vm.prank(owner1);
        wallet.executeTransaction(txId2);

        assertEq(owner2.balance - balance2Before, 1 ether);
        assertEq(owner3.balance - balance3Before, 2 ether);
    }
}

contract MaliciousReentry {
    MultiSigWallet public wallet;
    bool public attacked;

    constructor(MultiSigWallet _wallet) {
        wallet = _wallet;
    }

    receive() external payable {
        if (!attacked && msg.sender == address(wallet)) {
            attacked = true;
            // Try to reenter executeTransaction
            wallet.executeTransaction(0);
        }
    }
}
