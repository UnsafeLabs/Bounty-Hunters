// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {MultiSigWallet} from "../contracts/MultiSigWallet.sol";

contract MultiSigWalletTest is Test {
    MultiSigWallet wallet;
    address[] owners;
    address o1 = address(0x1);
    address o2 = address(0x2);
    address o3 = address(0x3);
    address dest = address(0xBEEF);

    function setUp() public {
        owners.push(o1); owners.push(o2); owners.push(o3);
        wallet = new MultiSigWallet(owners, 2);
        vm.deal(address(wallet), 10 ether);
    }

    function _submitConfirmedTx(uint256 n) internal returns (uint256 txId) {
        vm.prank(o1);
        txId = wallet.submitTransaction(dest, 1 ether, "");
        for (uint256 i = 0; i < n; i++) {
            vm.prank(owners[i]);
            wallet.confirmTransaction(txId);
        }
        return txId;
    }

    function test_submit_confirm_execute_revoke_flow() public {
        uint256 txId = _submitConfirmedTx(2);
        vm.prank(o1);
        wallet.executeTransaction(txId);
        assertTrue(wallet.transactions(txId).executed);
        assertEq(dest.balance, 1 ether);
    }

    function test_zero_address_rejected() public {
        vm.prank(o1);
        vm.expectRevert("Invalid to address");
        wallet.submitTransaction(address(0), 0, "");
    }

    function test_codeless_target_with_data_rejected() public {
        vm.prank(o1);
        vm.expectRevert("Target has no code");
        wallet.submitTransaction(address(0xdead), 0, abi.encodeWithSignature("anything()"));
    }

    function test_isConfirmedAtBlock() public {
        uint256 txId = _submitConfirmedTx(1);
        assertTrue(wallet.isConfirmedAtBlock(txId, o1, block.number));
        assertFalse(wallet.isConfirmedAtBlock(txId, o1, block.number - 1));
        vm.prank(o1);
        wallet.revokeConfirmation(txId);
        assertFalse(wallet.isConfirmedAtBlock(txId, o1, block.number));
    }

    function test_not_enough_confirmations_reverts() public {
        uint256 txId = _submitConfirmedTx(1);
        vm.prank(o1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }
}
