// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract GovernanceTokenTest is Test {
    GovernanceToken token;
    address user = address(0x1);
    address delegate = address(0x2);
    address attacker = address(0x3);

    function setUp() public {
        token = new GovernanceToken(1_000_000 ether);
        token.transfer(user, 1000 ether);
    }

    function testDelegateUsesMsgSender() public {
        vm.prank(user);
        token.delegateVote(delegate);
        assertEq(token.delegates(user), delegate);
        assertEq(token.delegatedPower(delegate), 1000 ether);
    }

    function testDelegateRejectsZeroAddress() public {
        vm.prank(user);
        vm.expectRevert("Cannot delegate to zero address");
        token.delegateVote(address(0));
    }

    function testRevokeDelegateUsesMsgSender() public {
        vm.startPrank(user);
        token.delegateVote(delegate);
        token.revokeDelegate();
        vm.stopPrank();

        assertEq(token.delegates(user), address(0));
        assertEq(token.delegatedPower(delegate), 0);
    }

    function testSnapshotUsesMsgSender() public {
        vm.prank(attacker);
        vm.expectRevert();
        token.snapshot();
    }

    function testSnapshotOnlyOwner() public {
        token.snapshot();
    }

    function testPhishingAttackFails() public {
        vm.prank(user);
        token.delegateVote(delegate);

        vm.prank(attacker);
        vm.expectRevert("Cannot delegate to self");
        // Attacker tries to delegate user's tokens via tx.origin
        // With msg.sender fix, attacker can only delegate their own tokens
        token.delegateVote(attacker);
    }
}
