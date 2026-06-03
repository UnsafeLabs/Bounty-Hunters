// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/MultiSigWallet.sol";

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
        
        // Fund the wallet
        vm.deal(address(wallet), 10 ether);
    }
    
    function test_SubmitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        (address to, uint256 value, , bool executed, ) = wallet.transactions(txId);
        assertEq(to, address(0x1));
        assertEq(value, 1 ether);
        assertFalse(executed);
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
    
    function test_ConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        assertTrue(wallet.confirmations(txId, owner2));
    }
    
    function test_ConfirmTransaction_AlreadyConfirmed_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
    }
    
    function test_RevokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);
        
        assertFalse(wallet.confirmations(txId, owner2));
    }
    
    function test_ExecuteTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        
        (, , , bool executed, ) = wallet.transactions(txId);
        assertTrue(executed);
    }
    
    function test_ExecuteTransaction_NotEnoughConfirmations_Reverts() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
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
    
    function test_IsConfirmedAtBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        // Check at current block
        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));
        
        // Check at previous block (should be false because confirmations are at current block)
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number - 1));
    }
    
    function test_ConfirmationBlocks() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 blockNumber = wallet.confirmationBlocks(txId, owner2);
        assertEq(blockNumber, block.number);
    }
    
    function test_GetConfirmationCount() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        assertEq(wallet.getConfirmationCount(txId), 0);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        assertEq(wallet.getConfirmationCount(txId), 1);
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        assertEq(wallet.getConfirmationCount(txId), 2);
    }
    
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
    }
    
    function test_Receive() public {
        vm.deal(address(0x1), 1 ether);
        vm.prank(address(0x1));
        (bool success, ) = address(wallet).call{value: 1 ether}("");
        assertTrue(success);
    }
}
