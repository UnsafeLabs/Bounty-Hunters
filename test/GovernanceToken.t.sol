// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/GovernanceToken.sol";

contract GovernanceTokenTest is Test {
    GovernanceToken public token;

    address public owner = vm.addr(1);
    address public user = vm.addr(2);
    address public delegate = vm.addr(3);

    function setUp() public {
        vm.prank(owner);
        token = new GovernanceToken(1000 ether);

        vm.prank(owner);
        token.transfer(user, 100 ether);
    }

    function test_DelegateVote() public {
        vm.prank(user);
        token.delegateVote(delegate);

        assertEq(token.delegates(user), delegate);
        assertEq(token.delegatedPower(delegate), 100 ether);
    }

    function test_DelegateVote_Self_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(user);
    }

    function test_RevokeDelegate() public {
        vm.prank(user);
        token.delegateVote(delegate);

        vm.prank(user);
        token.revokeDelegate();

        assertEq(token.delegates(user), address(0));
        assertEq(token.delegatedPower(delegate), 0);
    }

    function test_Snapshot_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        token.snapshot();
    }

    function test_Vote() public {
        uint256 proposalId = token.createProposal("Test proposal", 1 days);

        vm.prank(user);
        token.vote(proposalId, true);

        assertTrue(token.hasVoted(proposalId, user));
    }
}
