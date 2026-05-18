// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "lib/forge-std/src/Test.sol";
import "lib/forge-std/src/console.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingContract {
    GovernanceToken public token;
    address public attacker;

    constructor(address _token, address _attacker) {
        token = GovernanceToken(_token);
        attacker = _attacker;
    }

    function trickUser() external {
        token.delegateVote(attacker);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    PhishingContract public phisher;

    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public attacker = address(0x3);

    function setUp() public {
        token = new GovernanceToken(0);
        phisher = new PhishingContract(address(token), attacker);

        token.mint(user1, 1000 ether);
        token.mint(user2, 500 ether);
    }

    function test_DelegateVoteUsesMsgSender() public {
        vm.prank(user1);
        token.delegateVote(user2);

        assertEq(token.delegates(user1), user2);
        assertEq(token.delegatedPower(user2), 1000 ether);
    }

    function test_PhishingContractCannotDelegateUserVotes() public {
        vm.prank(user1);
        phisher.trickUser();

        assertEq(token.delegatedPower(attacker), 0);
        assertEq(token.delegates(user1), address(0));
    }

    function test_RevokeDelegate() public {
        vm.prank(user1);
        token.delegateVote(user2);
        assertEq(token.delegates(user1), user2);

        vm.prank(user1);
        token.revokeDelegate();
        assertEq(token.delegates(user1), address(0));
        assertEq(token.delegatedPower(user2), 0);
    }

    function test_RejectSelfDelegate() public {
        vm.prank(user1);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(user1);
    }

    function test_OnlyOwnerCanSnapshot() public {
        token.snapshot();

        vm.prank(user1);
        vm.expectRevert();
        token.snapshot();
    }

    function test_VotingPower() public {
        assertEq(token.getVotingPower(user1), 1000 ether);

        vm.prank(user1);
        token.delegateVote(user2);

        assertEq(token.getVotingPower(user1), 1000 ether);
        assertEq(token.getVotingPower(user2), 1000 ether);
    }

    function test_CreateProposalAndVote() public {
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 1000);

        vm.prank(user1);
        token.vote(proposalId, true);

        (string memory desc, uint256 forVotes, uint256 againstVotes, uint256 endTime, bool executed) = token.proposals(proposalId);
        assertEq(forVotes, 1000 ether);
        assertEq(againstVotes, 0);
    }

    function test_CannotVoteTwice() public {
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test", 1000);

        vm.prank(user1);
        token.vote(proposalId, true);

        vm.prank(user1);
        vm.expectRevert("Already voted");
        token.vote(proposalId, false);
    }
}
