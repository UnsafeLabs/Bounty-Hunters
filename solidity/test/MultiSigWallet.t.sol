// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/MultiSigWallet.sol";

contract MaliciousCallback {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    address public ownerB;

    constructor(MultiSigWallet _wallet, uint256 _targetTxId, address _ownerB) {
        wallet = _wallet;
        targetTxId = _targetTxId;
        ownerB = _ownerB;
    }

    receive() external payable {
        wallet.revokeConfirmation(targetTxId);
    }

    function attack() external {
        wallet.revokeConfirmation(targetTxId);
    }
}

contract MultiSigWalletTest {
    MultiSigWallet public wallet;
    address public ownerA = address(0x1);
    address public ownerB = address(0x2);
    address public nonOwner = address(0x9);
    address[] public owners;

    function setUp() public {
        owners.push(ownerA);
        owners.push(ownerB);
        wallet = new MultiSigWallet(owners, 2);
    }

    function testSubmitTransaction() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");
        assertEq(txId, 0);

        (address to, uint256 value, , bool executed) = wallet.transactions(0);
        assertEq(to, address(0x3));
        assertEq(value, 0);
        assertFalse(executed);
    }

    function testSubmitTransactionRejectsZeroAddress() public {
        vm.prank(ownerA);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 0, "");
    }

    function testSubmitTransactionOnlyOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(0x3), 0, "");
    }

    function testConfirmTransaction() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    function testCannotConfirmTwice() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerA);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
    }

    function testExecuteTransaction() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerB);
        wallet.confirmTransaction(txId);

        vm.prank(ownerA);
        wallet.executeTransaction(txId);

        (, , , bool executed) = wallet.transactions(txId);
        assertTrue(executed);
    }

    function testCannotExecuteWithoutEnoughConfirmations() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerA);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function testCannotExecuteTwice() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerB);
        wallet.confirmTransaction(txId);

        vm.prank(ownerA);
        wallet.executeTransaction(txId);

        vm.prank(ownerA);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    function testRevokeConfirmation() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        assertEq(wallet.getConfirmationCount(txId), 1);

        vm.prank(ownerA);
        wallet.revokeConfirmation(txId);

        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    function testCannotRevokeUnconfirmed() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        vm.expectRevert("Not confirmed");
        wallet.revokeConfirmation(txId);
    }

    function testReentrancyGuardPreventsRaceCondition() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerB);
        wallet.confirmTransaction(txId);

        MaliciousCallback callback = new MaliciousCallback(wallet, txId, ownerB);

        vm.etch(address(callback), type(MaliciousCallback).runtimeCode);

        vm.prank(ownerA);
        uint256 secondTxId = wallet.submitTransaction(address(callback), 0, "");

        vm.prank(ownerB);
        wallet.confirmTransaction(secondTxId);

        vm.prank(ownerA);
        wallet.confirmTransaction(secondTxId);

        vm.prank(ownerB);
        wallet.revokeConfirmation(secondTxId);
    }

    function testIsConfirmedAtBlock() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerB);
        wallet.confirmTransaction(txId);

        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number - 1));
    }

    function testIsConfirmedAtBlockWithRevocation() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerB);
        wallet.confirmTransaction(txId);

        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));

        vm.prank(ownerA);
        wallet.revokeConfirmation(txId);

        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));
    }

    function testCannotExecuteAlreadyExecuted() public {
        vm.prank(ownerA);
        uint256 txId = wallet.submitTransaction(address(0x3), 0, "");

        vm.prank(ownerA);
        wallet.confirmTransaction(txId);

        vm.prank(ownerB);
        wallet.confirmTransaction(txId);

        vm.prank(ownerA);
        wallet.executeTransaction(txId);

        vm.prank(ownerA);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }
}
