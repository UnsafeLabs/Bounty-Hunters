// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

// Plain payable recipient for simple ETH-transfer tests.
contract Receiver {
    receive() external payable {}
}

// Malicious owner contract: on receiving ETH it attempts to revoke a
// confirmation on another tx and re-enter executeTransaction.
contract Reentrant {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    bool public attack;

    function arm(MultiSigWallet _wallet, uint256 _targetTxId) external {
        wallet = _wallet;
        targetTxId = _targetTxId;
        attack = true;
    }

    receive() external payable {
        if (attack) {
            attack = false; // avoid infinite loop if guard ever failed
            wallet.revokeConfirmation(targetTxId);
            wallet.executeTransaction(targetTxId);
        }
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet wallet;
    address owner1 = address(0x1);
    address owner2 = address(0x2);
    address owner3 = address(0x3);

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        wallet = new MultiSigWallet(owners, 2);
        vm.deal(address(wallet), 100 ether);
    }

    function _submitTo(address to, uint256 value) internal returns (uint256 txId) {
        vm.prank(owner1);
        txId = wallet.submitTransaction(to, value, "");
    }

    function testSubmitAndConfirm() public {
        Receiver r = new Receiver();
        uint256 txId = _submitTo(address(r), 1 ether);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (, , , bool executed) = wallet.transactions(txId);
        assertTrue(executed);
        assertEq(address(r).balance, 1 ether);
    }

    function testRevokeDuringCallback() public {
        // Make a malicious contract an owner so it can call wallet functions.
        Reentrant attacker = new Reentrant();
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = address(attacker);
        wallet = new MultiSigWallet(owners, 2);
        vm.deal(address(wallet), 100 ether);

        // tx0 pays the attacker; its receive() will try to re-enter on tx1.
        vm.prank(owner1);
        uint256 tx0 = wallet.submitTransaction(address(attacker), 1 ether, "");
        Receiver r = new Receiver();
        vm.prank(owner1);
        uint256 tx1 = wallet.submitTransaction(address(r), 1 ether, "");

        // Confirm both txs with 2 owners.
        vm.prank(owner1);
        wallet.confirmTransaction(tx0);
        vm.prank(owner2);
        wallet.confirmTransaction(tx0);
        vm.prank(owner1);
        wallet.confirmTransaction(tx1);
        vm.prank(address(attacker));
        wallet.confirmTransaction(tx1);

        attacker.arm(wallet, tx1);

        // Executing tx0 triggers the callback; re-entry is blocked, so the
        // low-level call fails and the whole execution reverts.
        vm.prank(owner1);
        vm.expectRevert(bytes("Execution failed"));
        wallet.executeTransaction(tx0);

        // Neither tx executed; state rolled back.
        (, , , bool executed0) = wallet.transactions(tx0);
        (, , , bool executed1) = wallet.transactions(tx1);
        assertFalse(executed0);
        assertFalse(executed1);
    }

    function testFrontRunningRevocation() public {
        vm.roll(100);
        Receiver r = new Receiver();
        uint256 txId = _submitTo(address(r), 1 ether);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Confirmed at block 100 → valid as of block 100, not before.
        assertTrue(wallet.isConfirmedAtBlock(txId, 100));
        assertFalse(wallet.isConfirmedAtBlock(txId, 99));

        // A revocation drops the count; the snapshot no longer qualifies.
        vm.roll(101);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);
        assertFalse(wallet.isConfirmedAtBlock(txId, 101));

        vm.prank(owner1);
        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(txId);
    }

    function testZeroAddressRejection() public {
        vm.prank(owner1);
        vm.expectRevert(bytes("Invalid recipient"));
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    function testGasLimit() public {
        Receiver r = new Receiver();
        uint256 txId = _submitTo(address(r), 1 ether);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        uint256 before = gasleft();
        wallet.executeTransaction(txId);
        uint256 used = before - gasleft();
        assertLt(used, 100_000);
    }

    function testRevokeThenExecute() public {
        Receiver r = new Receiver();
        uint256 txId = _submitTo(address(r), 1 ether);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        vm.prank(owner1);
        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(txId);
    }

    function testMultipleConfirmations() public {
        Receiver r = new Receiver();
        uint256 txId = _submitTo(address(r), 2 ether);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        vm.prank(owner3);
        wallet.confirmTransaction(txId);
        assertEq(wallet.getConfirmationCount(txId), 3);

        vm.prank(owner1);
        wallet.executeTransaction(txId);
        assertEq(address(r).balance, 2 ether);
    }
}
