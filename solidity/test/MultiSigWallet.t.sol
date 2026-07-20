// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

contract MultiSigWalletTest is Test {
    MultiSigWallet wallet;
    address owner1 = address(0x1);
    address owner2 = address(0x2);
    address owner3 = address(0x3);
    address nonOwner = address(0x4);

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        wallet = new MultiSigWallet(owners, 2);
        vm.deal(address(wallet), 10 ether);
    }

    function testSubmitRejectsZeroAddress() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address target");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    function testNormalFlow() public {
        vm.startPrank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x5), 1 ether, "");
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 before = address(0x5).balance;

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertEq(address(0x5).balance, before + 1 ether);
    }

    function testCannotRevokeDuringExecution() public {
        ReentrancyRevoker revoker = new ReentrancyRevoker(wallet);
        vm.deal(address(revoker), 5 ether);

        vm.startPrank(owner1);
        uint256 txId = wallet.submitTransaction(address(revoker), 0.5 ether, "");
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert();
        wallet.executeTransaction(txId);
    }

    function testIsConfirmedAtBlock() public {
        vm.startPrank(owner1);
        uint256 txId = wallet.submitTransaction(address(0x5), 1 ether, "");
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        uint256 confirmBlock = block.number;

        vm.roll(block.number + 5);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, confirmBlock));
        assertFalse(wallet.isConfirmedAtBlock(txId, owner2, confirmBlock));
        assertTrue(wallet.isConfirmedAtBlock(txId, owner2, block.number));
    }
}

contract ReentrancyRevoker {
    MultiSigWallet public wallet;
    bool public revoked;

    constructor(MultiSigWallet _wallet) {
        wallet = _wallet;
    }

    receive() external payable {
        if (!revoked) {
            revoked = true;
        }
    }
}
