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
        vm.deal(address(wallet), 10 ether);
    }
    
    function test_SubmitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        assertEq(txId, 0);
    }
    
    function test_SubmitTransaction_ZeroAddress_Reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 1 ether, "");
    }
    
    function test_ConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        assertTrue(wallet.confirmations(txId, owner2));
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
    
    function test_IsConfirmedAtBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x1), 1 ether, "");
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));
    }
}
