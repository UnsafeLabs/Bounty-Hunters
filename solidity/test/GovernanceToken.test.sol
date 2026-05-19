// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

/// @dev Malicious contract that attempts to delegate victim's votes via tx.origin phishing
contract PhishingContract {
    GovernanceToken public token;
    address public attacker;

    constructor(address _token, address _attacker) {
        token = GovernanceToken(_token);
        attacker = _attacker;
    }

    /// @notice Victim calls this — in the old code tx.origin would be the victim,
    ///         allowing the attacker to steal delegation. With msg.sender fix,
    ///         delegation goes to THIS contract, not the victim.
    function phishDelegate() external {
        token.delegateVote(attacker);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;

    address public admin = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public charlie = address(0xC);

    uint256 constant INITIAL_SUPPLY = 1_000_000 ether;

    function setUp() public {
        token = new GovernanceToken(INITIAL_SUPPLY);

        // Distribute tokens
        token.transfer(alice, 100_000 ether);
        token.transfer(bob, 50_000 ether);
        token.transfer(charlie, 25_000 ether);
    }

    // ─── tx.origin phishing prevention ─────────────────────────────────

    function test_phishingContract_cannotDelegateVictimVotes() public {
        // Deploy phishing contract that tries to delegate to attacker (bob)
        PhishingContract phisher = new PhishingContract(address(token), bob);

        // Alice (victim) calls the phishing contract
        vm.prank(alice);
        phisher.phishDelegate();

        // With msg.sender fix: delegation is from the PhishingContract, NOT alice
        // Alice's delegate should still be address(0) — untouched
        assertEq(
            token.delegates(alice),
            address(0),
            "Alice's delegation must NOT be changed by phishing contract"
        );

        // The phishing contract delegated its own (zero-balance) power
        assertEq(
            token.delegates(address(phisher)),
            bob,
            "Phishing contract delegated its own votes (harmless)"
        );

        // Bob should NOT have gained Alice's 100k voting power
        assertEq(
            token.delegatedPower(bob),
            0,
            "Bob must NOT receive delegated power from phishing"
        );
    }

    // ─── Delegation basics ─────────────────────────────────────────────

    function test_delegateVote_success() public {
        vm.prank(alice);
        token.delegateVote(bob);

        assertEq(token.delegates(alice), bob);
        assertEq(token.delegatedPower(bob), 100_000 ether);
    }

    function test_delegateVote_changeDelegation() public {
        // Alice delegates to Bob first
        vm.prank(alice);
        token.delegateVote(bob);
        assertEq(token.delegatedPower(bob), 100_000 ether);

        // Alice changes delegation to Charlie
        vm.prank(alice);
        token.delegateVote(charlie);

        assertEq(token.delegates(alice), charlie);
        assertEq(token.delegatedPower(bob), 0, "Bob should lose delegated power");
        assertEq(token.delegatedPower(charlie), 100_000 ether, "Charlie gains power");
    }

    function test_revert_delegateToSelf() public {
        vm.prank(alice);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(alice);
    }

    function test_revert_delegateToZeroAddress() public {
        vm.prank(alice);
        vm.expectRevert("Cannot delegate to zero address");
        token.delegateVote(address(0));
    }

    // ─── Revoke delegation ─────────────────────────────────────────────

    function test_revokeDelegate_success() public {
        vm.startPrank(alice);
        token.delegateVote(bob);
        assertEq(token.delegatedPower(bob), 100_000 ether);

        token.revokeDelegate();
        vm.stopPrank();

        assertEq(token.delegates(alice), address(0));
        assertEq(token.delegatedPower(bob), 0, "Bob loses delegated power");
    }

    function test_revert_revokeWithoutDelegate() public {
        vm.prank(alice);
        vm.expectRevert("No delegate");
        token.revokeDelegate();
    }

    // ─── Ownable admin (snapshot) ──────────────────────────────────────

    function test_snapshot_onlyOwner() public {
        // Admin (deployer = this contract) can call snapshot
        token.snapshot(); // should not revert
    }

    function test_revert_snapshot_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        token.snapshot();
    }

    // ─── Voting power ──────────────────────────────────────────────────

    function test_getVotingPower_includesDelegation() public {
        assertEq(token.getVotingPower(bob), 50_000 ether, "Own balance only");

        vm.prank(alice);
        token.delegateVote(bob);

        assertEq(
            token.getVotingPower(bob),
            150_000 ether,
            "Own balance + Alice's delegation"
        );
    }

    // ─── Proposal & voting ─────────────────────────────────────────────

    function test_createProposal_and_vote() public {
        uint256 pid = token.createProposal("Increase rewards", 1 days);
        assertEq(pid, 0);

        // Alice votes for
        vm.prank(alice);
        token.vote(pid, true);

        (,uint256 forVotes,,,) = token.proposals(pid);
        assertEq(forVotes, token.getVotingPower(alice));
    }

    function test_revert_doubleVote() public {
        uint256 pid = token.createProposal("Test", 1 days);

        vm.startPrank(alice);
        token.vote(pid, true);

        vm.expectRevert("Already voted");
        token.vote(pid, false);
        vm.stopPrank();
    }

    function test_revert_voteAfterEnd() public {
        uint256 pid = token.createProposal("Test", 1 hours);

        // Warp past end time
        vm.warp(block.timestamp + 2 hours);

        vm.prank(alice);
        vm.expectRevert("Voting ended");
        token.vote(pid, true);
    }

    // ─── No tx.origin remains ──────────────────────────────────────────

    function test_noTxOriginUsed_delegateViaContract() public {
        // Deploy a legitimate intermediary contract and delegate through it
        // msg.sender = intermediary, tx.origin = alice
        // With fix, delegation is from intermediary (which holds 0 tokens) — safe
        LegitimateProxy proxy = new LegitimateProxy(address(token));

        vm.prank(alice);
        proxy.delegateFor(bob);

        // Alice should NOT be affected
        assertEq(token.delegates(alice), address(0));
        // Proxy delegated its own (zero) power — harmless
        assertEq(token.delegates(address(proxy)), bob);
        assertEq(token.delegatedPower(bob), 0);
    }
}

/// @dev Legitimate contract calling delegateVote — ensures msg.sender logic works
contract LegitimateProxy {
    GovernanceToken public token;

    constructor(address _token) {
        token = GovernanceToken(_token);
    }

    function delegateFor(address to) external {
        token.delegateVote(to);
    }
}
