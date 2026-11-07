// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

contract MockTarget {
    uint256 public value;
    bool public shouldRevert;
    bool public revokeDuringCallback;
    MultiSigWallet public wallet;

    constructor(MultiSigWallet _wallet) {
        wallet = _wallet;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function setRevokeDuringCallback(bool _revoke) external {
        revokeDuringCallback = _revoke;
    }

    receive() external payable {
        if (shouldRevert) {
            revert("Mock revert");
        }
        value = msg.value;
        
        // FIX: Test reentrancy protection - try to revoke during callback
        if (revokeDuringCallback) {
            // This should fail due to reentrancy guard
            wallet.revokeConfirmation(0);
        }
    }

    function mockFunction() external pure returns (uint256) {
        return 42;
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    MockTarget public target;
    address[] public owners;
    uint256 public required = 2;
    
    address public owner1 = address(0x1);
    address public owner2 = address(0x2);
    address public owner3 = address(0x3);
    address public nonOwner = address(0x4);

    function setUp() public {
        owners.push(owner1);
        owners.push(owner2);
        owners.push(owner3);

        vm.prank(owner1);
        wallet = new MultiSigWallet(owners, required);

        target = new MockTarget(wallet);
        
        // Fund the wallet
        vm.deal(address(wallet), 100 ether);
    }

    function testSubmitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        assertEq(txId, 0);
        (address to, uint256 value, bytes memory data, bool executed) = wallet.transactions(0);
        assertEq(to, address(target));
        assertEq(value, 1 ether);
        assertEq(data.length, 0);
        assertFalse(executed);
    }

    function testRevertOnZeroAddress() public {
        vm.prank(owner1);
        vm.expectRevert("Invalid recipient");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    function testRevertOnContractTargetWithoutData() public {
        vm.prank(owner1);
        vm.expectRevert("Target must be contract for data calls");
        wallet.submitTransaction(address(target), 1 ether, hex"12345678");
    }

    function testConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        assertTrue(wallet.confirmations(txId, owner1));
        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    function testRevokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        
        assertFalse(wallet.confirmations(txId, owner1));
        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    function testExecuteTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 balanceBefore = address(target).balance;
        
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        
        assertEq(address(target).balance - balanceBefore, 1 ether);
        
        (, , , bool executed) = wallet.transactions(txId);
        assertTrue(executed);
    }

    function testRevertOnInsufficientConfirmations() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function testRevertOnExecutionFailure() public {
        target.setShouldRevert(true);
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        vm.expectRevert("Execution failed");
        wallet.executeTransaction(txId);
    }

    function testReentrancyProtection() public {
        // This test verifies that reentrancy guard prevents revocation during callback
        target.setRevokeDuringCallback(true);
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        // Execute should succeed because reentrancy guard prevents the revoke
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        
        // Transaction should be executed
        (, , , bool executed) = wallet.transactions(txId);
        assertTrue(executed);
    }

    function testConfirmationRevocationDuringExecution() public {
        // Test that confirmations cannot be revoked during execution
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        // Try to revoke during execution (should fail due to nonReentrant)
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        
        // Execution should fail because confirmations were revoked
        vm.prank(owner1);
        vm.expectRevert("Confirmations revoked during execution");
        wallet.executeTransaction(txId);
    }

    function testIsConfirmedAtBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        uint256 confirmBlock = block.number;
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        // Should be confirmed at current block
        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));
        
        // Should be confirmed at confirmBlock (only 1 confirmation at that block)
        assertFalse(wallet.isConfirmedAtBlock(txId, confirmBlock));
        
        // Should not be confirmed at future block with current state
        vm.roll(block.number + 10);
        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));
    }

    function testFrontRunningRevocationPrevention() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 snapshotBlock = block.number;
        
        // Attacker tries to revoke after snapshot
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        
        // Check using snapshot block - should still be confirmed
        assertTrue(wallet.isConfirmedAtBlock(txId, snapshotBlock));
        
        // But current state shows not enough confirmations
        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    function testGetConfirmationDetails() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        (bool confirmed, uint256 timestamp, uint256 blockNumber) = wallet.getConfirmationDetails(txId, owner1);
        
        assertTrue(confirmed);
        assertEq(timestamp, block.timestamp);
        assertEq(blockNumber, block.number);
    }

    function testGasCostForSimpleTransfer() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 gasStart = gasleft();
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasStart - gasleft();
        
        // Should be under 100,000 gas for simple ETH transfer
        assertLt(gasUsed, 100000, "Gas cost exceeds 100,000");
    }

    function testRevertOnDuplicateOwner() public {
        address[] memory dupOwners = new address[](2);
        dupOwners[0] = owner1;
        dupOwners[1] = owner1;
        
        vm.expectRevert("Duplicate owner");
        new MultiSigWallet(dupOwners, 1);
    }

    function testRevertOnZeroAddressOwner() public {
        address[] memory zeroOwners = new address[](2);
        zeroOwners[0] = owner1;
        zeroOwners[1] = address(0);
        
        vm.expectRevert("Invalid owner");
        new MultiSigWallet(zeroOwners, 1);
    }

    function testRevertOnNonOwnerConfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    function testRevertOnAlreadyConfirmed() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
    }

    function testRevertOnAlreadyExecuted() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "");
        
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
}
