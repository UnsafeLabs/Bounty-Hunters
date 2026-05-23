// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingContract {
    GovernanceToken public token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function phishDelegate(address to) external {
        token.delegateVote(to);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public admin = address(0x100);
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public delegate = address(0x3);

    function setUp() public {
        vm.prank(admin);
        token = new GovernanceToken(1_000_000e18);

        vm.prank(admin);
        token.transfer(user1, 100_000e18);
        vm.prank(admin);
        token.transfer(user2, 200_000e18);
    }

    function test_DelegateVoteWithMsgSender() public {
        vm.prank(user1);
        token.delegateVote(delegate);

        assertEq(token.delegates(user1), delegate);
        assertEq(token.delegatedPower(delegate), 100_000e18);
    }

    function test_RevokeDelegate() public {
        vm.prank(user1);
        token.delegateVote(delegate);

        vm.prank(user1);
        token.revokeDelegate();

        assertEq(token.delegates(user1), address(0));
        assertEq(token.delegatedPower(delegate), 0);
    }

    function test_PhishingContractCannotDelegate() public {
        PhishingContract phisher = new PhishingContract(token);

        vm.prank(user1);
        phisher.phishDelegate(delegate);

        assertEq(token.delegates(user1), address(0), "User should NOT be delegated");
        assertEq(token.delegates(address(phisher)), delegate, "Phisher only delegates itself");
    }

    function test_DelegateCannotBeZero() public {
        vm.prank(user1);
        vm.expectRevert("Cannot delegate to zero");
        token.delegateVote(address(0));
    }

    function test_DelegateCannotBeSelf() public {
        vm.prank(user1);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(user1);
    }

    function test_SnapshotOnlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        token.snapshot();

        vm.prank(admin);
        token.snapshot();
    }

    function test_VotingPowerWithDelegation() public {
        assertEq(token.getVotingPower(user1), 100_000e18);

        vm.prank(user1);
        token.delegateVote(delegate);

        assertEq(token.getVotingPower(delegate), 100_000e18);
        assertEq(token.getVotingPower(user1), 100_000e18);
    }

    function test_DelegateVotingInProposal() public {
        vm.prank(user1);
        token.delegateVote(delegate);

        vm.prank(admin);
        uint256 propId = token.createProposal("Test", 100);

        vm.prank(delegate);
        token.vote(propId, true);

        (, uint256 forVotes,,,) = token.proposals(propId);
        assertEq(forVotes, 100_000e18);
    }

    function test_NoDelegatePowerAfterRevoke() public {
        vm.prank(user1);
        token.delegateVote(delegate);

        vm.prank(user1);
        token.revokeDelegate();

        assertEq(token.delegatedPower(delegate), 0);
    }

    function test_MultipleDelegates() public {
        vm.prank(user1);
        token.delegateVote(delegate);
        vm.prank(user2);
        token.delegateVote(delegate);

        assertEq(token.delegatedPower(delegate), 300_000e18);

        vm.prank(user1);
        token.revokeDelegate();

        assertEq(token.delegatedPower(delegate), 200_000e18);
    }
}
