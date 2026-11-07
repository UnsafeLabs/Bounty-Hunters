// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public admin;
    address public user1;
    address public user2;
    address public user3;

    function setUp() public {
        admin = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        user3 = makeAddr("user3");

        token = new GovernanceToken(1000000 * 1e18);
        
        // Distribute tokens
        token.transfer(user1, 100000 * 1e18);
        token.transfer(user2, 100000 * 1e18);
        token.transfer(user3, 100000 * 1e18);
    }

    function test_InitialState() public view {
        assertEq(token.name(), "Governance");
        assertEq(token.symbol(), "GOV");
        assertEq(token.owner(), admin);
        assertEq(token.totalSupply(), 1000000 * 1e18);
    }

    function test_DelegateVote() public {
        vm.prank(user1);
        token.delegateVote(user2);

        assertEq(token.delegates(user1), user2);
        assertEq(token.delegatedPower(user2), 100000 * 1e18);
    }

    function test_DelegateVoteCannotDelegateToSelf() public {
        vm.prank(user1);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(user1);
    }

    function test_DelegateVoteCannotDelegateToZeroAddress() public {
        vm.prank(user1);
        vm.expectRevert("Invalid delegate");
        token.delegateVote(address(0));
    }

    function test_RevokeDelegate() public {
        // First delegate
        vm.prank(user1);
        token.delegateVote(user2);
        assertEq(token.delegatedPower(user2), 100000 * 1e18);

        // Then revoke
        vm.prank(user1);
        token.revokeDelegate();
        assertEq(token.delegates(user1), address(0));
        assertEq(token.delegatedPower(user2), 0);
    }

    function test_RevokeDelegateFailsWithNoDelegate() public {
        vm.prank(user1);
        vm.expectRevert("No delegate");
        token.revokeDelegate();
    }

    function test_GetVotingPowerWithoutDelegation() public view {
        uint256 power = token.getVotingPower(user1);
        assertEq(power, 100000 * 1e18);
    }

    function test_GetVotingPowerWithDelegation() public {
        // user1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);

        // user1's voting power should only be delegated power (0)
        uint256 user1Power = token.getVotingPower(user1);
        assertEq(user1Power, 0);

        // user2's voting power should be own balance + delegated power
        uint256 user2Power = token.getVotingPower(user2);
        assertEq(user2Power, 200000 * 1e18); // 100k own + 100k delegated
    }

    function test_GetVotingPowerCannotQueryZeroAddress() public {
        vm.expectRevert("Invalid account");
        token.getVotingPower(address(0));
    }

    function test_SnapshotOnlyOwner() public {
        // Admin can call snapshot
        token.snapshot();

        // Non-admin cannot call snapshot
        vm.prank(user1);
        vm.expectRevert();
        token.snapshot();
    }

    function test_TxOriginPhishingAttackFails() public {
        // Deploy malicious contract
        MaliciousContract malicious = new MaliciousContract(token);

        // User1 interacts with malicious contract
        vm.prank(user1);
        malicious.attack(user2);

        // Verify that the delegation happened from malicious contract, not user1
        // This is the key fix: msg.sender is used, not tx.origin
        assertEq(token.delegates(address(malicious)), user2);
        assertEq(token.delegates(user1), address(0)); // user1 did NOT delegate
        
        // user1's voting power should remain unchanged
        assertEq(token.getVotingPower(user1), 100000 * 1e18);
    }

    function test_CreateProposal() public {
        uint256 proposalId = token.createProposal("Test proposal", 1 days);
        assertEq(proposalId, 0);

        (string memory description, , , , ) = token.proposals(0);
        assertEq(description, "Test proposal");
    }

    function test_VoteOnProposal() public {
        uint256 proposalId = token.createProposal("Test proposal", 1 days);

        vm.prank(user1);
        token.vote(proposalId, true);

        (, uint256 forVotes, , , ) = token.proposals(proposalId);
        assertEq(forVotes, 100000 * 1e18);
        assertTrue(token.hasVoted(proposalId, user1));
    }

    function test_VoteCannotVoteTwice() public {
        uint256 proposalId = token.createProposal("Test proposal", 1 days);

        vm.prank(user1);
        token.vote(proposalId, true);

        vm.prank(user1);
        vm.expectRevert("Already voted");
        token.vote(proposalId, false);
    }

    function test_VoteCannotVoteAfterEndTime() public {
        uint256 proposalId = token.createProposal("Test proposal", 1 days);

        // Warp time past end
        vm.warp(block.timestamp + 2 days);

        vm.prank(user1);
        vm.expectRevert("Voting ended");
        token.vote(proposalId, true);
    }

    function test_VoteRequiresVotingPower() public {
        uint256 proposalId = token.createProposal("Test proposal", 1 days);

        address noBalance = makeAddr("noBalance");
        vm.prank(noBalance);
        vm.expectRevert("No voting power");
        token.vote(proposalId, true);
    }

    function test_MultipleDelegations() public {
        // user1 and user2 both delegate to user3
        vm.prank(user1);
        token.delegateVote(user3);
        
        vm.prank(user2);
        token.delegateVote(user3);

        // user3 should have combined delegated power
        assertEq(token.delegatedPower(user3), 200000 * 1e18);
        assertEq(token.getVotingPower(user3), 300000 * 1e18); // 100k own + 200k delegated

        // user1 and user2 should have zero voting power
        assertEq(token.getVotingPower(user1), 0);
        assertEq(token.getVotingPower(user2), 0);
    }

    function test_ChangeDelegate() public {
        // user1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);
        assertEq(token.delegatedPower(user2), 100000 * 1e18);

        // user1 changes delegate to user3
        vm.prank(user1);
        token.delegateVote(user3);
        
        // user2 should lose the delegated power
        assertEq(token.delegatedPower(user2), 0);
        // user3 should gain it
        assertEq(token.delegatedPower(user3), 100000 * 1e18);
    }

    function test_DelegationAfterTokenTransfer() public {
        // user1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);
        assertEq(token.delegatedPower(user2), 100000 * 1e18);

        // user1 transfers tokens to user3
        vm.prank(user1);
        token.transfer(user3, 50000 * 1e18);

        // Delegated power should remain the same (snapshot at delegation time)
        // This is a design choice - some protocols update on transfer
        assertEq(token.delegatedPower(user2), 100000 * 1e18);
        
        // But voting power calculation should reflect current balance
        // user2's total voting power
        assertEq(token.getVotingPower(user2), 150000 * 1e18); // 100k own + 50k remaining from user1
    }
}

// Malicious contract that attempts phishing attack
contract MaliciousContract {
    GovernanceToken public token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function attack(address to) external {
        // This attempts to delegate votes using tx.origin
        // With the fix, this will delegate from this contract's address, not msg.sender
        token.delegateVote(to);
    }
}
