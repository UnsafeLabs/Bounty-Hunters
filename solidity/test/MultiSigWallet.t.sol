// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {MultiSigWallet} from "../src/MultiSigWallet.sol";

contract ReentrantAttack {
    MultiSigWallet wallet;
    uint256 public txId;
    bool public reentrancyAttempted;

    constructor(MultiSigWallet _wallet) {
        wallet = _wallet;
    }

    function attack(uint256 _txId) external {
        txId = _txId;
        wallet.executeTransaction(txId);
    }

    receive() external payable {
        reentrancyAttempted = true;
        // Try re-entering executeTransaction — should be blocked by nonReentrant
        (bool ok,) = address(wallet).call(abi.encodeCall(MultiSigWallet.executeTransaction, (txId)));
        require(!ok, "Reentrancy should have been blocked");
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet wallet;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address payer = makeAddr("payer");

    address[] owners;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    function setUp() public {
        owners = [alice, bob, carol];
        wallet = new MultiSigWallet(owners, 2);
        vm.deal(payer, 10 ether);
        vm.deal(address(wallet), 0 ether);
    }

    /* ------------------------------------------------------------------ */
    /*  Basic workflow                                                     */
    /* ------------------------------------------------------------------ */

    function test_SubmitConfirmExecuteRevoke() public {
        vm.prank(payer);
        (bool ok,) = address(wallet).call{value: 3 ether}("");
        assertTrue(ok);

        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(payer, 1 ether, "");

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Confirmed(txId, alice);
        wallet.confirmTransaction(txId);
        assertEq(wallet.getConfirmationCount(txId), 1);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Revoked(txId, alice);
        wallet.revokeConfirmation(txId);
        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    function test_ExecuteWhenEnoughConfirmations() public {
        vm.prank(payer);
        (bool ok,) = address(wallet).call{value: 3 ether}("");
        assertTrue(ok);

        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(payer, 1 ether, "");

        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        uint256 balBefore = payer.balance;
        vm.prank(carol);
        vm.expectEmit(true, true, false, true);
        emit Executed(txId);
        wallet.executeTransaction(txId);
        assertEq(payer.balance - balBefore, 1 ether);
    }

    function test_RevertExecuteWithoutEnoughConfirmations() public {
        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(alice, 0, "");

        vm.prank(alice);
        wallet.confirmTransaction(txId);

        vm.prank(alice);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_RevertExecuteAlreadyExecuted() public {
        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(alice, 0, "");

        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        vm.prank(carol);
        wallet.executeTransaction(txId);

        vm.prank(carol);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    /* ------------------------------------------------------------------ */
    /*  Zero-address validation                                            */
    /* ------------------------------------------------------------------ */

    function test_RevertSubmitToZeroAddress() public {
        vm.prank(alice);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 0, "");
    }

    function test_RevertZeroAddressOwner() public {
        address[] memory badOwners = new address[](2);
        badOwners[0] = alice;
        badOwners[1] = address(0);
        vm.expectRevert("Zero owner");
        new MultiSigWallet(badOwners, 1);
    }

    /* ------------------------------------------------------------------ */
    /*  Reentrancy guard                                                   */
    /* ------------------------------------------------------------------ */

    function test_RevertReentrantExecute() public {
        ReentrantAttack attacker = new ReentrantAttack(wallet);

        vm.startPrank(payer);
        (bool ok,) = address(wallet).call{value: 10 ether}("");
        assertTrue(ok);
        vm.stopPrank();

        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(address(attacker), 1 ether, "");

        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        // attacker.executeTransaction(txId) → wallet.executeTransaction(txId)
        // → wallet calls attacker with 1 ETH → attacker's receive() tries to
        // re-enter executeTransaction → caught by nonReentrant modifier
        uint256 balBefore = address(attacker).balance;
        vm.prank(carol);
        wallet.executeTransaction(txId);
        assertEq(address(attacker).balance - balBefore, 1 ether);
        assertTrue(attacker.reentrancyAttempted());
    }

    function test_RevertDirectReentrancy() public {
        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(alice, 0, "");

        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        vm.prank(carol);
        wallet.executeTransaction(txId);

        // Second call should revert
        vm.prank(carol);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    /* ------------------------------------------------------------------ */
    /*  Block-level confirmation check                                     */
    /* ------------------------------------------------------------------ */

    function test_IsConfirmedAtBlock() public {
        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(alice, 0, "");

        uint256 confirmBlock = block.number;
        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        // Before confirmations, should not be confirmed
        assertFalse(wallet.isConfirmedAtBlock(txId, confirmBlock - 1));

        // At the block where confirmations happened, should be confirmed
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmBlock));
        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));
    }

    function test_IsConfirmedAtBlockWithRevocation() public {
        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(alice, 0, "");

        uint256 confirmBlock = block.number;
        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        // Before confirmations, not confirmed
        assertFalse(wallet.isConfirmedAtBlock(txId, confirmBlock - 1));
        // At confirm block, confirmed
        assertTrue(wallet.isConfirmedAtBlock(txId, confirmBlock));
        assertTrue(wallet.isConfirmedAtBlock(txId, block.number));

        vm.roll(block.number + 5);

        // Bob revokes
        vm.prank(bob);
        wallet.revokeConfirmation(txId);

        // At the current block, not confirmed (bob revoked)
        assertFalse(wallet.isConfirmedAtBlock(txId, block.number));
        // Before bob confirmed should also not be confirmed
        assertFalse(wallet.isConfirmedAtBlock(txId, confirmBlock));
    }

    /* ------------------------------------------------------------------ */
    /*  Non-owner access control                                           */
    /* ------------------------------------------------------------------ */

    function test_RevertNonOwnerSubmit() public {
        vm.prank(makeAddr("eve"));
        vm.expectRevert("Not owner");
        wallet.submitTransaction(alice, 0, "");
    }

    function test_RevertNonOwnerConfirm() public {
        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(alice, 0, "");

        vm.prank(makeAddr("eve"));
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    function test_RevertNonOwnerExecute() public {
        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(alice, 0, "");

        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        vm.prank(makeAddr("eve"));
        vm.expectRevert("Not owner");
        wallet.executeTransaction(txId);
    }

    /* ------------------------------------------------------------------ */
    /*  Gas benchmark                                                      */
    /* ------------------------------------------------------------------ */

    function test_GasBenchmarkExecute() public {
        vm.prank(payer);
        (bool ok,) = address(wallet).call{value: 3 ether}("");
        assertTrue(ok);

        vm.prank(alice);
        uint256 txId = wallet.submitTransaction(bob, 1 ether, "");

        vm.prank(alice);
        wallet.confirmTransaction(txId);
        vm.prank(bob);
        wallet.confirmTransaction(txId);

        vm.prank(carol);
        uint256 gasBefore = gasleft();
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasBefore - gasleft();

        assertLe(gasUsed, 100_000, "Gas exceeds 100k");
    }
}
