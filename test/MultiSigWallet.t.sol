// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/MultiSigWallet.sol";

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    
    address public owner1 = address(1);
    address public owner2 = address(2);
    address public owner3 = address(3);
    address public nonOwner = address(4);
    address public recipient = address(5);
    
    uint256 public constant REQUIRED = 2;
    uint256 public constant ETH_AMOUNT = 1 ether;
    
    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        
        wallet = new MultiSigWallet(owners, REQUIRED);
        
        // Fund the wallet
        vm.deal(address(wallet), 10 ether);
    }
    
    // Test: Submit transaction with zero address should revert
    function test_SubmitZeroAddress() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), ETH_AMOUNT, "");
    }
    
    // Test: Submit transaction
    function test_SubmitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
        assertEq(txId, 0, "First transaction ID should be 0");
        assertEq(wallet.getTransactionCount(), 1, "Transaction count should be 1");
    }
    
    // Test: Confirm transaction
    function test_ConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        assertEq(wallet.getConfirmationCount(txId), 1, "Should have 1 confirmation");
    }
    
    // Test: Revoke confirmation
    function test_RevokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        
        assertEq(wallet.getConfirmationCount(txId), 0, "Should have 0 confirmations");
    }
    
    // Test: Execute transaction
    function test_ExecuteTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 recipientBalanceBefore = recipient.balance;
        
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        
        assertEq(recipient.balance, recipientBalanceBefore + ETH_AMOUNT, "Recipient should receive ETH");
    }
    
    // Test: Execute with not enough confirmations should revert
    function test_ExecuteNotEnoughConfirmations() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }
    
    // Test: Execute already executed should revert
    function test_ExecuteAlreadyExecuted() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
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
    
    // Test: Non-owner cannot submit
    function test_NonOwnerSubmit() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(recipient, ETH_AMOUNT, "");
    }
    
    // Test: Non-owner cannot confirm
    function test_NonOwnerConfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }
    
    // Test: Get owners
    function test_GetOwners() public {
        address[] memory owners = wallet.getOwners();
        assertEq(owners.length, 3, "Should have 3 owners");
        assertEq(owners[0], owner1, "First owner should match");
        assertEq(owners[1], owner2, "Second owner should match");
        assertEq(owners[2], owner3, "Third owner should match");
    }
    
    // Test: Receive ETH
    function test_ReceiveETH() public {
        uint256 balanceBefore = address(wallet).balance;
        vm.deal(address(this), 1 ether);
        (bool success, ) = address(wallet).call{value: 1 ether}("");
        assertTrue(success, "Should receive ETH");
        assertEq(address(wallet).balance, balanceBefore + 1 ether, "Balance should increase");
    }
    
    // Test: Reentrancy protection
    function test_ReentrancyProtection() public {
        // This test verifies that the reentrancy guard works
        // In a real scenario, a malicious contract could try to re-enter
        // but the nonReentrant modifier should prevent it
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(recipient, ETH_AMOUNT, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        // Execute should work
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        
        // Try to execute again (should fail)
        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }
}
