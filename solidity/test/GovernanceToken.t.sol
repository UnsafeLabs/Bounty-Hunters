// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

/// @dev Simulates a phishing contract that tries to delegate on a victim's behalf.
/// After the fix, delegateVote keys off msg.sender (this contract), not tx.origin
/// (the victim), so it can never move the victim's voting power.
contract PhishingContract {
    GovernanceToken token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function phish(address delegateTo) external {
        token.delegateVote(delegateTo);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken token;

    address owner = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCAA01);

    uint256 constant SUPPLY = 1_000_000e18;

    function setUp() public {
        token = new GovernanceToken(SUPPLY);
        token.transfer(alice, 1000e18);
        token.transfer(bob, 500e18);
        token.transfer(carol, 250e18);
    }

    function testDelegateVote() public {
        vm.prank(alice);
        token.delegateVote(bob);

        assertEq(token.delegates(alice), bob);
        assertEq(token.delegatedPower(bob), 1000e18);
        assertEq(token.getVotingPower(bob), 500e18 + 1000e18);
    }

    function testRevokeDelegate() public {
        vm.prank(alice);
        token.delegateVote(bob);

        vm.prank(alice);
        token.revokeDelegate();

        assertEq(token.delegates(alice), address(0));
        assertEq(token.delegatedPower(bob), 0);
        assertEq(token.getVotingPower(bob), 500e18);
    }

    /// @dev tx.origin == alice but msg.sender == phisher: the victim's delegation
    /// must remain untouched.
    function testPhishingAttack() public {
        PhishingContract phisher = new PhishingContract(token);

        vm.prank(alice, alice); // msg.sender AND tx.origin = alice
        phisher.phish(bob);

        // Victim is unaffected.
        assertEq(token.delegates(alice), address(0));
        // The phisher only delegated its own (zero) power — proving msg.sender semantics.
        assertEq(token.delegates(address(phisher)), bob);
        assertEq(token.delegatedPower(bob), 0);
    }

    function testSnapshotOnlyOwner() public {
        token.snapshot(); // owner succeeds

        vm.prank(alice);
        vm.expectRevert(); // OZ Ownable: OwnableUnauthorizedAccount
        token.snapshot();
    }

    function testVoteWithDelegatedPower() public {
        vm.prank(alice);
        token.delegateVote(bob);

        uint256 pid = token.createProposal("Test proposal", 1 days);

        vm.prank(bob);
        token.vote(pid, true);

        (, uint256 forVotes,,,) = token.proposals(pid);
        assertEq(forVotes, 500e18 + 1000e18);
    }

    function testCreateAndExecuteProposal() public {
        uint256 pid = token.createProposal("Increase treasury", 1 days);

        vm.prank(alice);
        token.vote(pid, true);
        vm.prank(bob);
        token.vote(pid, false);

        (, uint256 forVotes, uint256 againstVotes,,) = token.proposals(pid);
        assertEq(forVotes, 1000e18);
        assertEq(againstVotes, 500e18);
    }

    function testZeroAddressGuard() public {
        vm.prank(alice);
        vm.expectRevert("Invalid delegate");
        token.delegateVote(address(0));
    }
}
