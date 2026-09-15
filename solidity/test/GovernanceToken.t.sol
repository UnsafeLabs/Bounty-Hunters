// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

/// @notice Simulates the #912 attack: victim is lured into calling this
/// contract, which forwards a delegation to the token. Pre-fix the token
/// recorded tx.origin (the victim), stealing their votes; post-fix only the
/// forwarder's own (zero) balance is delegated.
contract PhishingForwarder {
    GovernanceToken public token;
    address public attacker;

    constructor(GovernanceToken _token, address _attacker) {
        token = _token;
        attacker = _attacker;
    }

    function lure() external {
        token.delegateVote(attacker);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public victim = address(0xBEEF);
    address public userA = address(0xA11CE);
    address public delegateeB = address(0xB0B);
    address public attacker = address(0xBAD);

    function setUp() public {
        token = new GovernanceToken(1_000_000);
        token.transfer(victim, 1_000);
        token.transfer(userA, 1_000);
        token.transfer(delegateeB, 500);
    }

    function testDirectDelegationWorks() public {
        vm.prank(userA);
        token.delegateVote(delegateeB);

        assertEq(token.delegates(userA), delegateeB);
        assertEq(token.delegatedPower(delegateeB), 1_000);
        // Delegator gave power away: no double count.
        assertEq(token.getVotingPower(userA), 0);
        assertEq(token.getVotingPower(delegateeB), 1_500);
    }

    function testPhishingContractCannotStealVictimVotes() public {
        PhishingForwarder forwarder = new PhishingForwarder(token, attacker);

        // Victim is tricked into calling the malicious contract.
        vm.prank(victim);
        forwarder.lure();

        // Victim's delegation slot untouched; attacker gained nothing.
        assertEq(token.delegates(victim), address(0));
        assertEq(token.delegatedPower(attacker), 0);
        assertEq(token.getVotingPower(victim), 1_000);
        assertEq(token.getVotingPower(attacker), 0);
    }

    function testSnapshotOnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        token.snapshot();

        // Owner (deployer) still works.
        token.snapshot();
    }

    function testDelegatedVoteCountsOnce() public {
        vm.prank(userA);
        token.delegateVote(delegateeB);

        uint256 proposalId = token.createProposal("fund x", 1 days);

        vm.prank(delegateeB);
        token.vote(proposalId, true);

        (, uint256 forVotes,,,) = _proposal(proposalId);
        assertEq(forVotes, 1_500);

        // Delegator has no power left to vote with.
        vm.prank(userA);
        vm.expectRevert("No voting power");
        token.vote(proposalId, true);
    }

    function testRevokeRestoresPower() public {
        vm.prank(userA);
        token.delegateVote(delegateeB);
        vm.prank(userA);
        token.revokeDelegate();

        assertEq(token.delegates(userA), address(0));
        assertEq(token.delegatedPower(delegateeB), 0);
        assertEq(token.getVotingPower(userA), 1_000);
    }

    function testCannotDelegateToSelfOrZero() public {
        vm.prank(userA);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(userA);

        vm.prank(userA);
        vm.expectRevert("Cannot delegate to zero address");
        token.delegateVote(address(0));
    }

    function _proposal(uint256 id)
        internal
        view
        returns (string memory desc, uint256 forV, uint256 againstV, uint256 end, bool exec)
    {
        // proposals(uint) returns the struct tuple in order.
        (desc, forV, againstV, end, exec) = token.proposals(id);
    }
}
