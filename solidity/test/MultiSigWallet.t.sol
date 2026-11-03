// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MultiSigWallet} from "../contracts/MultiSigWallet.sol";

/// @dev Owner contract that revokes a confirmation from inside the receive callback.
contract Revoker {
    MultiSigWallet wallet;
    uint256 txId;

    constructor(MultiSigWallet _w) { wallet = _w; }

    function setTx(uint256 _id) external { txId = _id; }
    function setWallet(MultiSigWallet _w) external { wallet = _w; }

    receive() external payable { wallet.revokeConfirmation(txId); }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet wallet;
    address o1 = address(0xA11CE);
    address o2 = address(0xB0B);
    Revoker revoker;
    address payable sink = payable(address(0xCAFE));

    function setUp() public {
        revoker = new Revoker(MultiSigWallet(payable(address(0))));
        address[] memory owners = new address[](3);
        owners[0] = o1;
        owners[1] = o2;
        owners[2] = address(revoker);
        wallet = new MultiSigWallet(owners, 3);
        revoker = new Revoker(wallet);
        // re-deploy with the real revoker address
        owners[2] = address(revoker);
        wallet = new MultiSigWallet(owners, 3);
        revoker.setWallet(wallet);
        vm.deal(address(wallet), 100 ether);
    }

    function _submit(address to, uint256 value, bytes memory data) internal returns (uint256) {
        vm.prank(o1);
        return wallet.submitTransaction(to, value, data);
    }

    function test_ZeroAddressRejected() public {
        vm.prank(o1);
        vm.expectRevert(MultiSigWallet.ZeroAddress.selector);
        wallet.submitTransaction(address(0), 0, "");
    }

    function test_CallWithDataToEOARejected() public {
        vm.prank(o1);
        vm.expectRevert(MultiSigWallet.TargetNotContract.selector);
        wallet.submitTransaction(sink, 0, hex"1234");
    }

    function test_FlowSubmitConfirmExecute() public {
        uint256 id = _submit(sink, 1 ether, "");
        vm.prank(o1);
        wallet.confirmTransaction(id);
        vm.prank(o2);
        wallet.confirmTransaction(id);
        vm.prank(address(revoker));
        wallet.confirmTransaction(id);

        vm.roll(block.number + 1);
        uint256 before = sink.balance;
        vm.prank(o1);
        wallet.executeTransaction(id);

        assertEq(sink.balance, before + 1 ether);
        (, , , bool exec) = wallet.transactions(id);
        assertTrue(exec);
    }

    function test_NotEnoughConfirmations() public {
        uint256 id = _submit(sink, 1 ether, "");
        vm.prank(o1);
        wallet.confirmTransaction(id);
        vm.roll(block.number + 1);
        vm.expectRevert(MultiSigWallet.NotEnoughConfirmations.selector);
        vm.prank(o1);
        wallet.executeTransaction(id);
    }

    function test_CallbackRevocationBlocksExecution() public {
        uint256 id = _submit(address(revoker), 1 ether, "");
        revoker.setTx(id);
        vm.prank(o1);
        wallet.confirmTransaction(id);
        vm.prank(o2);
        wallet.confirmTransaction(id);
        vm.prank(address(revoker));
        wallet.confirmTransaction(id);

        vm.roll(block.number + 1);
        vm.expectRevert(MultiSigWallet.ConfirmationRevoked.selector);
        vm.prank(o1);
        wallet.executeTransaction(id);
    }

    function test_SameBlockConfirmationIsNotCounted() public {
        uint256 id = _submit(sink, 1 ether, "");
        vm.prank(o1);
        wallet.confirmTransaction(id);
        vm.prank(o2);
        wallet.confirmTransaction(id);
        vm.prank(address(revoker));
        wallet.confirmTransaction(id);
        // no roll: confirmations land in the current block, snapshot is block-1
        vm.expectRevert(MultiSigWallet.NotEnoughConfirmations.selector);
        vm.prank(o1);
        wallet.executeTransaction(id);
    }

    function test_RevokeAndReconfirm() public {
        uint256 id = _submit(sink, 1 ether, "");
        vm.prank(o1);
        wallet.confirmTransaction(id);
        vm.prank(o1);
        wallet.revokeConfirmation(id);
        assertEq(wallet.getConfirmationCount(id), 0);
        vm.prank(o1);
        wallet.confirmTransaction(id);
        assertEq(wallet.getConfirmationCount(id), 1);
    }

    function test_ExecuteGasUnder100k() public {
        address[] memory owners = new address[](1);
        owners[0] = o1;
        MultiSigWallet small = new MultiSigWallet(owners, 1);
        vm.deal(address(small), 10 ether);

        vm.prank(o1);
        uint256 id = small.submitTransaction(sink, 0.1 ether, "");
        vm.prank(o1);
        small.confirmTransaction(id);

        vm.roll(block.number + 1);
        vm.prank(o1);
        uint256 gasBefore = gasleft();
        small.executeTransaction(id);
        uint256 used = gasBefore - gasleft();
        assertLt(used, 100_000, "execute gas over 100k");
    }
}
