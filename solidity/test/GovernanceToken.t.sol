// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

/// @title Phishing contract that attempts to exploit tx.origin vulnerability
contract PhishingContract {
    GovernanceToken public token;

    constructor(address _token) {
        token = GovernanceToken(_token);
    }

    /// @notice Trick a user into calling this, which tries to delegate their votes
    function phishingDelegate(address to) external {
        // With msg.sender fix, this only delegates the contract's own (zero) balance
        token.delegateVote(to);
    }

    /// @notice Trick a user into calling this, which tries to revoke their delegate
    function phishingRevoke() external {
        // With msg.sender fix, this only revokes the contract's own delegate
        token.revokeDelegate();
    }

    /// @notice Try to call admin-only snapshot through the phishing contract
    function callSnapshot() external {
        token.snapshot();
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        token = new GovernanceToken(1_000_000e18);
        token.transfer(alice, 100_000e18);
        token.transfer(bob, 100_000e18);
        token.transfer(carol, 50_000e18);
    }

    // ── Delegation Tests ──

    function test_delegateVote_works() public {
        vm.prank(alice);
        token.delegateVote(bob);
        assertEq(token.delegates(alice), bob);
        assertEq(token.delegatedPower(bob), 100_000e18);
    }

    function test_delegateVote_cannotDelegateToSelf() public {
        vm.prank(alice);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(alice);
    }

    function test_revokeDelegate_works() public {
        vm.prank(alice);
        token.delegateVote(bob);

        vm.prank(alice);
        token.revokeDelegate();
        assertEq(token.delegates(alice), address(0));
        assertEq(token.delegatedPower(bob), 0);
    }

    function test_revokeDelegate_revertsWhenNoDelegate() public {
        vm.prank(alice);
        vm.expectRevert("No delegate");
        token.revokeDelegate();
    }

    // ── Voting Power ──

    function test_getVotingPower_includesDelegated() public {
        vm.prank(alice);
        token.delegateVote(bob);
        uint256 power = token.getVotingPower(bob);
        assertEq(power, 100_000e18 + 100_000e18); // bob's own + alice's delegated
    }

    // ── Proposal & Voting ──

    function test_createProposal() public {
        uint256 proposalId = token.createProposal("Test Proposal", 1 days);
        (string memory description,,,,) = token.proposals(proposalId);
        assertEq(description, "Test Proposal");
    }

    function test_vote() public {
        token.createProposal("Test Proposal", 1 days);
        vm.prank(alice);
        token.vote(0, true);
        (, uint256 forVotes,,,) = token.proposals(0);
        assertEq(forVotes, 100_000e18);
    }

    function test_vote_cannotVoteTwice() public {
        token.createProposal("Test Proposal", 1 days);
        vm.prank(alice);
        token.vote(0, true);
        vm.prank(alice);
        vm.expectRevert("Already voted");
        token.vote(0, false);
    }

    function test_vote_revertsAfterVotingEnds() public {
        token.createProposal("Test Proposal", 1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        vm.expectRevert("Voting ended");
        token.vote(0, true);
    }

    // ── Snapshot Admin ──

    function test_snapshot_onlyOwner() public {
        token.snapshot(); // owner (this contract) can call
    }

    function test_snapshot_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert("Not admin");
        token.snapshot();
    }

    // ── PHISHING PROTECTION TESTS ──
    // These tests verify that replacing tx.origin with msg.sender prevents
    // phishing contracts from manipulating a user's delegation or calling
    // admin functions on their behalf.

    function test_phishingContract_cannotDelegateVictimVotes() public {
        // Deploy phishing contract
        PhishingContract phishing = new PhishingContract(address(token));

        // Alice is tricked into calling the phishing contract
        vm.prank(alice);
        phishing.phishingDelegate(bob);

        // Verify: Alice's delegation was NOT changed by the phishing contract.
        // msg.sender inside delegateVote() is the phishing contract, not alice,
        // so only the phishing contract's own (zero-balance) delegation is affected.
        assertEq(token.delegates(alice), address(0));
        assertEq(token.delegatedPower(bob), 0);

        // Verify: Bob does NOT have alice's voting power
        uint256 bobsPower = token.getVotingPower(bob);
        assertEq(bobsPower, 100_000e18); // only bob's own balance
    }

    function test_phishingContract_cannotRevokeVictimDelegate() public {
        // Alice legitimately delegates to bob
        vm.prank(alice);
        token.delegateVote(bob);
        assertEq(token.delegates(alice), bob);
        assertEq(token.delegatedPower(bob), 100_000e18);

        // Deploy phishing contract
        PhishingContract phishing = new PhishingContract(address(token));

        // Alice is tricked into calling the phishing contract's revoke
        vm.prank(alice);
        phishing.phishingRevoke();

        // Verify: Alice's delegation is still intact (phishing contract couldn't revoke it)
        assertEq(token.delegates(alice), bob);
        assertEq(token.delegatedPower(bob), 100_000e18);
    }

    function test_phishingContract_cannotCallSnapshot() public {
        // Deploy phishing contract
        PhishingContract phishing = new PhishingContract(address(token));

        // Even if alice calls the phishing contract, msg.sender inside snapshot()
        // is the phishing contract, not alice — so admin check fails
        vm.prank(alice);
        vm.expectRevert("Not admin");
        phishing.callSnapshot();
    }
}
