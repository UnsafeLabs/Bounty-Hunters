// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

contract ReentrantAttacker {
    MultiSigWallet public wallet;
    uint256 public txId;
    bool public attacked;
    bool public revokeFailed;

    constructor(MultiSigWallet _wallet) {
        wallet = _wallet;
    }

    function setTxId(uint256 _txId) external {
        txId = _txId;
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            (bool success, ) = address(wallet).call(
                abi.encodeWithSelector(wallet.revokeConfirmation.selector, txId)
            );
            revokeFailed = !success;
        }
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    address[] public owners;
    address public owner1 = address(0x1);
    address public owner2 = address(0x2);
    address public owner3 = address(0x3);
    address public nonOwner = address(0x9);

    function setUp() public {
        owners.push(owner1);
        owners.push(owner2);
        owners.push(owner3);
        wallet = new MultiSigWallet(owners, 2);
    }

    function test_SubmitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0xdead), 0, "");

        assertEq(txId, 0);
        (address to, uint256 val, bytes memory dt, bool exec,) = wallet.transactions(0);
        assertEq(to, address(0xdead));
        assertFalse(exec);
    }

    function test_SubmitTransactionRejectsZeroAddress() public {
        vm.prank(owner1);
        vm.expectRevert("Invalid recipient");
        wallet.submitTransaction(address(0), 0, "");
    }

    function test_SubmitTransactionRejectsSelf() public {
        vm.prank(owner1);
        vm.expectRevert("Cannot call self");
        wallet.submitTransaction(address(wallet), 0, "");
    }

    function test_ConfirmAndExecute() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0xdead), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        assertEq(wallet.getConfirmationCount(txId), 1);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        assertEq(wallet.getConfirmationCount(txId), 2);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (, , , bool execTx,) = wallet.transactions(txId);
        assertTrue(execTx);
    }

    function test_RevokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0xdead), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.revokeConfirmation(txId);

        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    function test_CannotExecuteWithoutEnoughConfirmations() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0xdead), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_NonOwnerCannotSubmit() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(0xdead), 0, "");
    }

    function test_NonOwnerCannotConfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0xdead), 0, "");

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    function test_ReentrancyDuringExecution() public {
        ReentrantAttacker attacker = new ReentrantAttacker(wallet);

        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(attacker), 0, "");

        attacker.setTxId(txId);

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        assertEq(wallet.getConfirmationCount(txId), 2);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(attacker.attacked(), "Attack should be attempted");
        assertTrue(attacker.revokeFailed(), "Revoke should be blocked by executed=true");
        assertEq(wallet.getConfirmationCount(txId), 2, "Count unchanged after blocked revoke");
    }

    function test_IsConfirmedAtBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0xdead), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        assertFalse(wallet.isConfirmedAtBlock(txId, block.number), "One conf not enough at block 1");

        vm.roll(block.number + 1);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        assertTrue(wallet.isConfirmedAtBlock(txId, block.number), "Two confs enough at block 2");
    }

    function test_ExecuteTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(0xdead), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (, , , bool execTx1,) = wallet.transactions(txId);
        assertTrue(execTx1);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }
}
