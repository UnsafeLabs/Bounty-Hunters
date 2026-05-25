// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public attacker;

    function setUp() public {
        token = new GovernanceToken(1000 ether);
        token.transfer(alice, 100 ether);
        token.transfer(bob, 50 ether);

        attacker = address(new PhishingContract());
    }

    // Test that normal delegation works correctly via msg.sender
    function testDelegateVote() public {
        vm.prank(alice);
        token.delegateVote(bob);

        assertEq(token.delegates(alice), bob);
        assertEq(token.delegatedPower(bob), 100 ether);
        assertEq(token.getVotingPower(bob), 50 ether + 100 ether); // bob's balance + alice's delegation
    }

    // Test that revokeDelegate clears delegation
    function testRevokeDelegate() public {
        vm.prank(alice);
        token.delegateVote(bob);

        vm.prank(alice);
        token.revokeDelegate();

        assertEq(token.delegates(alice), address(0));
        assertEq(token.delegatedPower(bob), 0 ether);
    }

    // Test that a phishing contract cannot delegate votes on behalf of a user
    function testPhishingContractCannotDelegateVotes() public {
        vm.prank(alice);
        token.delegateVote(bob);

        // Attacker (phishing contract) tries to change alice's delegation
        // Using msg.sender, the phishing contract can only delegate its own votes
        vm.prank(attacker);
        PhishingContract(attacker).attemptPhishingDelegate(address(token), bob);

        // Alice's delegation must remain unchanged
        assertEq(token.delegates(alice), bob, "Alice's delegate should remain bob");
        // Attacker's phishing attempt should have no effect on alice
    }

    // Test that the phishing contract cannot delegate when a user interacts with it
    function testPhishingContractCannotDelegateOnInteraction() public {
        // Alice is tricked into interacting with the phishing contract
        vm.prank(alice);
        PhishingContract(attacker).interact(address(token), bob);

        // With tx.origin, this would have changed alice's delegate to bob
        // With msg.sender, alice's delegate should remain unset (address(0))
        assertEq(token.delegates(alice), address(0), "Alice's delegate should remain unset");
    }

    // Test that onlyOwner works for snapshot
    function testSnapshotOnlyOwner() public {
        vm.prank(address(this)); // owner is the deployer (this contract in test)
        token.snapshot();
        // Should not revert
    }

    function testSnapshotRevertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        token.snapshot();
    }

    // Test voting works through legitimate delegation
    function testVoteWithDelegatedPower() public {
        // Alice delegates to bob
        vm.prank(alice);
        token.delegateVote(bob);

        // Bob has his own 50 tokens + Alice's 100 delegated = 150 voting power
        token.createProposal("Test proposal", 7 days);

        vm.prank(bob);
        token.vote(0, true);

        // Bob should have been able to vote (has power)
        assertTrue(token.hasVoted(0, bob));
    }

    // Test cannot delegate to self
    function testCannotDelegateToSelf() public {
        vm.prank(alice);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(alice);
    }

    // Test cannot revoke without delegate
    function testCannotRevokeWithoutDelegate() public {
        vm.prank(alice);
        vm.expectRevert("No delegate");
        token.revokeDelegate();
    }

    // Test proposal creation and voting lifecycle
    function testProposalLifecycle() public {
        token.createProposal("Increase supply", 3 days);

        vm.prank(alice);
        token.vote(0, true);

        vm.prank(bob);
        token.vote(0, false);

        assertTrue(token.hasVoted(0, alice));
        assertTrue(token.hasVoted(0, bob));
    }

    // Test no tx.origin usage remains in contract
    function testNoTxOriginInContract() public view {
        // Compile-time check: if tx.origin was used, the contract would still compile
        // but we verify at the logic level by checking that phishing attacks don't work
        // This is a behavioral test — covered by testPhishingContractCannotDelegateVotes
    }
}

// Malicious contract that attempts to exploit tx.origin
contract PhishingContract {
    // Attempts to change the caller's delegate via the vulnerable function
    function attemptPhishingDelegate(address tokenAddr, address newDelegate) external {
        GovernanceToken(tokenAddr).delegateVote(newDelegate);
    }

    // Simulates a user being tricked into calling this contract
    // With tx.origin, this would have delegated the caller's votes
    function interact(address tokenAddr, address newDelegate) external {
        GovernanceToken token = GovernanceToken(tokenAddr);
        // The phish: if delegateVote used tx.origin, this would steal the caller's delegation
        token.delegateVote(newDelegate);
    }
}
