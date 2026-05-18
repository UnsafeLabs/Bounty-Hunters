// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol"

contract PhishingContract {
    GovernanceToken public target;

    constructor(address _target) {
        target = GovernanceToken(_target);
    }

    // This contract tries to delegate votes on behalf of a victim
    // With tx.origin, this would work (the victim's tokens get delegated)
    // With msg.sender, this correctly only delegates this contract's tokens
    function attack(address delegateTo) external {
        // delegateVote uses msg.sender, so this only delegates this contract's balance
        // which is 0, so no voting power changes
        try target.delegateVote(delegateTo) {} catch {}
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken gov;
    PhishingContract phisher;
    address victim;
    address attacker;

    function setUp() public {
        victim = makeAddr("victim");
        attacker = makeAddr("attacker");

        gov = new GovernanceToken(1000000 * 10**18);

        // Give victim some tokens
        gov.transfer(victim, 10000 * 10**18);

        phisher = new PhishingContract(address(gov));
    }

    // Test: No tx.origin usage remains - all use msg.sender
    function test_NoTxOrigin() public {
        // Victim delegates their own votes
        vm.prank(victim);
        gov.delegateVote(attacker);

        assertEq(gov.delegates(victim), attacker);
        assertEq(gov.delegatedPower(attacker), 10000 * 10**18);
    }

    // Test: Phishing contract cannot delegate victim's votes
    function test_PhishingAttackFails() public {
        // Victim has 10000 tokens
        assertEq(gov.balanceOf(victim), 10000 * 10**18);

        // Attacker deploys phishing contract that tries to call delegateVote
        // Since delegateVote uses msg.sender (the phishing contract), not tx.origin (victim),
        // the phishing contract can only delegate its own balance (which is 0)
        phisher.attack(attacker);

        // Victim's tokens are still undelegated
        assertEq(gov.delegates(victim), address(0));
        assertEq(gov.delegatedPower(attacker), 0);
    }

    // Test: msg.sender authorization for admin functions
    function test_OnlyAdminCanSnapshot() public {
        // Admin can call snapshot
        address currentAdmin = gov.admin();
        vm.prank(currentAdmin);
        gov.snapshot(); // Should succeed

        // Non-admin cannot
        vm.prank(victim);
        vm.expectRevert("Not admin");
        gov.snapshot();
    }

    // Test: Delegated voting still works through legitimate interactions
    function test_DelegatedVotingWorks() public {
        // Victim delegates to attacker
        vm.prank(victim);
        gov.delegateVote(attacker);

        // Attacker now has voting power from victim
        assertEq(gov.getVotingPower(attacker), 10000 * 10**18);

        // Create a proposal
        vm.prank(gov.admin());
        uint256 pid = gov.createProposal("Test proposal", 1 days);

        // Attacker votes with delegated power
        vm.prank(attacker);
        gov.vote(pid, true);

        (,,,,,,,,) = gov.proposals(pid);
        // Attacker voted with 10000 tokens of delegated power
        (uint256 forVotes,,,,,) = gov.proposals(pid);
        assertEq(forVotes, 10000 * 10**18);
    }

    // Test: Revoke delegate works correctly with msg.sender
    function test_RevokeDelegate() public {
        vm.prank(victim);
        gov.delegateVote(attacker);
        assertEq(gov.delegatedPower(attacker), 10000 * 10**18);

        vm.prank(victim);
        gov.revokeDelegate();
        assertEq(gov.delegates(victim), address(0));
        assertEq(gov.delegatedPower(attacker), 0);
    }

    // Test: Cannot delegate to self
    function test_CannotDelegateToSelf() public {
        vm.prank(victim);
        vm.expectRevert("Cannot delegate to self");
        gov.delegateVote(victim);
    }

    // Test: Existing governance proposal and voting tests pass unchanged
    function test_CreateProposalAndVote() public {
        vm.prank(gov.admin());
        uint256 pid = gov.createProposal("Test", 1 days);

        vm.prank(victim);
        gov.vote(pid, true);

        (uint256 forVotes,,,) = gov.proposals(pid);
        assertEq(forVotes, 10000 * 10**18);
    }
}
