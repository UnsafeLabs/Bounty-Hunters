// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public owner;
    address public alice;
    address public bob;
    address public carol;

    uint256 constant INITIAL_SUPPLY = 1_000_000e18;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        token = new GovernanceToken(INITIAL_SUPPLY);

        // Distribute tokens
        token.transfer(alice, 100_000e18);
        token.transfer(bob, 50_000e18);
        token.transfer(carol, 25_000e18);
    }

    // ─────────────────────────────────────────────
    // Happy Path Delegation
    // ─────────────────────────────────────────────

    function test_delegateVote_happyPath() public {
        uint256 aliceBalance = token.balanceOf(alice);

        vm.prank(alice);
        token.delegateVote(bob);

        assertEq(token.delegates(alice), bob, "Alice should have bob as delegate");
        assertEq(token.delegatedPower(bob), aliceBalance, "Bob should have Alice's balance as delegated power");
        assertEq(token.getVotingPower(bob), token.balanceOf(bob) + aliceBalance, "Bob total voting power wrong");
        assertEq(token.getVotingPower(alice), token.balanceOf(alice), "Alice still has own balance as power");
    }

    function test_delegateVote_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit DelegateChanged(alice, bob);
        token.delegateVote(bob);
    }

    function test_delegateVote_multipleDelegations() public {
        uint256 aliceBalance = token.balanceOf(alice);
        uint256 carolBalance = token.balanceOf(carol);

        vm.prank(alice);
        token.delegateVote(bob);

        vm.prank(carol);
        token.delegateVote(bob);

        assertEq(token.delegatedPower(bob), aliceBalance + carolBalance, "Bob should have combined delegated power");
        assertEq(
            token.getVotingPower(bob),
            token.balanceOf(bob) + aliceBalance + carolBalance,
            "Bob total voting power wrong"
        );
    }

    // ─────────────────────────────────────────────
    // Phishing Attack Prevention (tx.origin fix)
    // ─────────────────────────────────────────────

    /// @dev A malicious contract tries to call delegateVote on behalf of the
    ///      EOA that called it. With tx.origin this would succeed — now it
    ///      correctly uses msg.sender so the malicious contract itself becomes
    ///      the delegator (and has no tokens to delegate).
    function test_phishingAttack_prevented() public {
        MaliciousContract mal = new MaliciousContract(address(token));

        // Alice interacts with the malicious contract (e.g., via phishing link)
        vm.prank(alice);
        mal.tryPhishingDelegate(bob);

        // Alice's delegation should be unchanged
        assertEq(token.delegates(alice), address(0), "Alice should NOT have been delegated via phishing");
        assertEq(token.delegatedPower(bob), 0, "Bob should have zero delegated power from phishing");

        // The malicious contract itself became the delegator (but has no tokens)
        assertEq(token.delegates(address(mal)), bob, "Malicious contract is delegator, not Alice");
    }

    function test_phishingRevoke_prevented() public {
        // Alice legitimately delegates to Bob first
        vm.prank(alice);
        token.delegateVote(bob);
        uint256 bobPowerBefore = token.getVotingPower(bob);

        // Malicious contract tries to revoke Alice's delegation
        MaliciousContract mal = new MaliciousContract(address(token));
        vm.prank(alice);
        mal.tryPhishingRevoke();

        // Alice's delegation should still be intact
        assertEq(token.delegates(alice), bob, "Alice delegation should still be to Bob");
        assertEq(token.getVotingPower(bob), bobPowerBefore, "Bob's power should be unchanged");
    }

    // ─────────────────────────────────────────────
    // Double Delegation / Re-delegation
    // ─────────────────────────────────────────────

    function test_doubleDelegation_switchesDelegate() public {
        uint256 aliceBalance = token.balanceOf(alice);

        // Alice delegates to Bob
        vm.prank(alice);
        token.delegateVote(bob);
        assertEq(token.delegates(alice), bob);
        assertEq(token.delegatedPower(bob), aliceBalance);

        // Alice switches delegation to Carol
        vm.prank(alice);
        token.delegateVote(carol);
        assertEq(token.delegates(alice), carol, "Alice should now delegate to Carol");
        assertEq(token.delegatedPower(bob), 0, "Bob should have zero delegated power from Alice");
        assertEq(token.delegatedPower(carol), aliceBalance, "Carol should have Alice's balance as delegated power");
    }

    function test_doubleDelegation_votingPowerUpdates() public {
        uint256 aliceBalance = token.balanceOf(alice);
        uint256 bobBalance = token.balanceOf(bob);

        // Alice delegates to Bob
        vm.prank(alice);
        token.delegateVote(bob);
        assertEq(token.getVotingPower(bob), bobBalance + aliceBalance);

        // Alice switches to Carol
        vm.prank(alice);
        token.delegateVote(carol);

        assertEq(token.getVotingPower(bob), bobBalance, "Bob's voting power should revert to own balance");
        assertEq(token.getVotingPower(carol), token.balanceOf(carol) + aliceBalance, "Carol gains Alice's power");
    }

    // ─────────────────────────────────────────────
    // Revoke Delegate
    // ─────────────────────────────────────────────

    function test_revokeDelegate() public {
        uint256 aliceBalance = token.balanceOf(alice);

        vm.prank(alice);
        token.delegateVote(bob);

        assertEq(token.delegatedPower(bob), aliceBalance);

        vm.prank(alice);
        token.revokeDelegate();

        assertEq(token.delegates(alice), address(0), "Alice should have no delegate");
        assertEq(token.delegatedPower(bob), 0, "Bob should have zero delegated power");
    }

    function test_revokeDelegate_noDelegate_reverts() public {
        vm.prank(alice);
        vm.expectRevert("No delegate");
        token.revokeDelegate();
    }

    function test_revokeDelegate_emitsEvent() public {
        vm.prank(alice);
        token.delegateVote(bob);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit DelegateChanged(alice, address(0));
        token.revokeDelegate();
    }

    // ─────────────────────────────────────────────
    // Self-Delegation Prevention
    // ─────────────────────────────────────────────

    function test_delegateVote_selfDelegation_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(alice);
    }

    // ─────────────────────────────────────────────
    // Snapshot Admin Check (tx.origin fix)
    // ─────────────────────────────────────────────

    function test_snapshot_adminCanCall() public {
        // owner (address(this)) is the admin
        token.snapshot();
        // Should not revert
    }

    function test_snapshot_nonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Not admin");
        token.snapshot();
    }

    function test_snapshot_phishingAdmin_prevented() public {
        // A malicious contract tries to call snapshot via a phished user who is admin
        MaliciousAdmin mal = new MaliciousAdmin(address(token));

        // Even if admin (owner) calls the malicious contract, snapshot should fail
        // because msg.sender will be the malicious contract, not the admin
        vm.prank(owner);
        vm.expectRevert("Not admin");
        mal.tryPhishingSnapshot();
    }

    // ─────────────────────────────────────────────
    // Vote Weight Tracking
    // ─────────────────────────────────────────────

    function test_getVotingPower_noDelegation() public {
        assertEq(token.getVotingPower(alice), token.balanceOf(alice));
        assertEq(token.getVotingPower(bob), token.balanceOf(bob));
    }

    function test_getVotingPower_withDelegation() public {
        uint256 aliceBalance = token.balanceOf(alice);

        vm.prank(alice);
        token.delegateVote(bob);

        assertEq(token.getVotingPower(bob), token.balanceOf(bob) + aliceBalance);
    }

    function test_getVotingPower_afterTokenTransfer() public {
        uint256 aliceBalance = token.balanceOf(alice);

        vm.prank(alice);
        token.delegateVote(bob);

        // Alice transfers some tokens to Carol — delegated power should update
        uint256 transferAmount = 10_000e18;
        vm.prank(alice);
        token.transfer(carol, transferAmount);

        // Bob's delegated power should decrease
        assertEq(
            token.delegatedPower(bob),
            aliceBalance - transferAmount,
            "Delegated power should decrease after transfer"
        );
    }

    function test_voteWeight_correctOnVote() public {
        uint256 aliceBalance = token.balanceOf(alice);

        vm.prank(alice);
        token.delegateVote(bob);

        // Create a proposal
        uint256 proposalId = token.createProposal("Test proposal", 1 days);

        // Bob votes — his power includes Alice's delegation
        uint256 bobExpectedPower = token.balanceOf(bob) + aliceBalance;
        assertEq(token.getVotingPower(bob), bobExpectedPower);

        vm.prank(bob);
        token.vote(proposalId, true);

        (,, uint256 forVotes,,) = token.proposals(proposalId);
        assertEq(forVotes, bobExpectedPower, "Vote weight should include delegated power");
    }

    // ─────────────────────────────────────────────
    // EIP-712 Delegate By Sig
    // ─────────────────────────────────────────────

    function test_delegateBySig_happyPath() public {
        uint256 alicePrivateKey = 0xA11CE;
        address aliceSigner = vm.addr(alicePrivateKey);

        // Fund Alice's signer address
        token.transfer(aliceSigner, 10_000e18);

        uint256 nonce = token.nonces(aliceSigner);
        uint256 expiry = block.timestamp + 1 hours;

        bytes32 domainSeparator = keccak256(
            abi.encode(token.DOMAIN_TYPEHASH(), keccak256(bytes("Governance")), block.chainid, address(token))
        );

        bytes32 structHash =
            keccak256(abi.encode(token.DELEGATION_TYPEHASH(), bob, nonce, expiry));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);

        token.delegateBySig(bob, nonce, expiry, v, r, s);

        assertEq(token.delegates(aliceSigner), bob, "Delegation by sig should work");
        assertEq(token.nonces(aliceSigner), 1, "Nonce should increment");
    }

    function test_delegateBySig_expiredSignature_reverts() public {
        uint256 alicePrivateKey = 0xA11CE;
        address aliceSigner = vm.addr(alicePrivateKey);

        token.transfer(aliceSigner, 10_000e18);

        uint256 nonce = token.nonces(aliceSigner);
        uint256 expiry = block.timestamp - 1; // Already expired

        bytes32 domainSeparator = keccak256(
            abi.encode(token.DOMAIN_TYPEHASH(), keccak256(bytes("Governance")), block.chainid, address(token))
        );

        bytes32 structHash =
            keccak256(abi.encode(token.DELEGATION_TYPEHASH(), bob, nonce, expiry));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);

        vm.expectRevert("Signature expired");
        token.delegateBySig(bob, nonce, expiry, v, r, s);
    }

    function test_delegateBySig_invalidNonce_reverts() public {
        uint256 alicePrivateKey = 0xA11CE;

        uint256 wrongNonce = 999;
        uint256 expiry = block.timestamp + 1 hours;

        bytes32 domainSeparator = keccak256(
            abi.encode(token.DOMAIN_TYPEHASH(), keccak256(bytes("Governance")), block.chainid, address(token))
        );

        bytes32 structHash =
            keccak256(abi.encode(token.DELEGATION_TYPEHASH(), bob, wrongNonce, expiry));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePrivateKey, digest);

        vm.expectRevert("Invalid nonce");
        token.delegateBySig(bob, wrongNonce, expiry, v, r, s);
    }

    // ─────────────────────────────────────────────
    // Edge Cases
    // ─────────────────────────────────────────────

    function test_delegate_zeroBalance() public {
        address noTokens = makeAddr("noTokens");

        vm.prank(noTokens);
        token.delegateVote(bob);

        // Delegation succeeds but delegatedPower is 0
        assertEq(token.delegates(noTokens), bob);
        assertEq(token.delegatedPower(bob), 0);
    }

    function test_delegate_thenReceiveTokens() public {
        address noTokens = makeAddr("noTokens");

        vm.prank(noTokens);
        token.delegateVote(bob);

        // Now send tokens to noTokens
        uint256 amount = 5_000e18;
        token.transfer(noTokens, amount);

        // Delegated power should reflect the new balance
        assertEq(token.delegatedPower(bob), amount, "Delegated power should update with new balance");
    }
}

// ─────────────────────────────────────────────
// Malicious Contracts for Phishing Tests
// ─────────────────────────────────────────────

contract MaliciousContract {
    GovernanceToken public token;

    constructor(address _token) {
        token = GovernanceToken(_token);
    }

    /// @dev Simulates a phishing attack: tricks EOA into calling this,
    ///      then tries to delegate the EOA's voting power via tx.origin
    function tryPhishingDelegate(address to) external {
        // With tx.origin bug, this would use the caller's address
        // Now it uses this contract's address (msg.sender) — phishing fails
        token.delegateVote(to);
    }

    function tryPhishingRevoke() external {
        token.revokeDelegate();
    }
}

contract MaliciousAdmin {
    GovernanceToken public token;

    constructor(address _token) {
        token = GovernanceToken(_token);
    }

    /// @dev Tries to call admin-only snapshot through a phished admin user
    function tryPhishingSnapshot() external {
        token.snapshot();
    }
}
