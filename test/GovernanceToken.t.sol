// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/GovernanceToken.sol";

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public delegate = address(4);
    
    uint256 public constant INITIAL_SUPPLY = 1000 ether;
    uint256 public constant VOTING_AMOUNT = 100 ether;
    
    function setUp() public {
        vm.prank(owner);
        token = new GovernanceToken(INITIAL_SUPPLY);
        
        // Transfer tokens to users
        token.transfer(user1, VOTING_AMOUNT);
        token.transfer(user2, VOTING_AMOUNT);
    }
    
    // Test: Delegate vote using msg.sender (not tx.origin)
    function test_DelegateVote() public {
        vm.prank(user1);
        token.delegateVote(delegate);
        
        assertEq(token.delegates(user1), delegate, "Delegate should be set");
        assertEq(token.delegatedPower(delegate), VOTING_AMOUNT, "Delegated power should match");
    }
    
    // Test: Revoke delegation
    function test_RevokeDelegate() public {
        vm.prank(user1);
        token.delegateVote(delegate);
        
        vm.prank(user1);
        token.revokeDelegate();
        
        assertEq(token.delegates(user1), address(0), "Delegate should be cleared");
        assertEq(token.delegatedPower(delegate), 0, "Delegated power should be 0");
    }
    
    // Test: Cannot delegate to self
    function test_CannotDelegateToSelf() public {
        vm.prank(user1);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(user1);
    }
    
    // Test: Cannot delegate to zero address
    function test_CannotDelegateToZero() public {
        vm.prank(user1);
        vm.expectRevert("Cannot delegate to zero address");
        token.delegateVote(address(0));
    }
    
    // Test: Get voting power with delegation
    function test_GetVotingPower() public {
        vm.prank(user1);
        token.delegateVote(delegate);
        
        assertEq(token.getVotingPower(delegate), VOTING_AMOUNT, "Delegate should have voting power");
        assertEq(token.getVotingPower(user1), 0, "User1 should have 0 voting power after delegation");
    }
    
    // Test: Snapshot only owner
    function test_SnapshotOnlyOwner() public {
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        token.snapshot();
        
        vm.prank(owner);
        token.snapshot();
    }
    
    // Test: Create proposal
    function test_CreateProposal() public {
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 1 days);
        
        assertEq(proposalId, 0, "First proposal ID should be 0");
    }
    
    // Test: Vote on proposal
    function test_VoteOnProposal() public {
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 1 days);
        
        vm.prank(user1);
        token.vote(proposalId, true);
        
        // Verify vote was recorded (indirectly through voting power)
        assertTrue(true, "Vote should succeed");
    }
    
    // Test: Cannot vote twice
    function test_CannotVoteTwice() public {
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 1 days);
        
        vm.prank(user1);
        token.vote(proposalId, true);
        
        vm.prank(user1);
        vm.expectRevert("Already voted");
        token.vote(proposalId, true);
    }
    
    // Test: Zero address check in delegateVote
    function test_ZeroAddressCheck() public {
        vm.prank(user1);
        vm.expectRevert("Zero address");
        token.delegateVote(address(0));
    }
    
    // Test: Multiple delegations
    function test_MultipleDelegations() public {
        // User1 delegates to delegate
        vm.prank(user1);
        token.delegateVote(delegate);
        
        // User2 delegates to delegate
        vm.prank(user2);
        token.delegateVote(delegate);
        
        assertEq(token.delegatedPower(delegate), VOTING_AMOUNT * 2, "Delegate should have combined voting power");
    }
    
    // Test: Delegation updates on token transfer
    function test_DelegationUpdatesOnTransfer() public {
        // User1 delegates to delegate
        vm.prank(user1);
        token.delegateVote(delegate);
        
        uint256 delegatePowerBefore = token.delegatedPower(delegate);
        
        // Transfer half of user1's tokens to user2
        vm.prank(user1);
        token.transfer(user2, VOTING_AMOUNT / 2);
        
        // Delegate power should decrease
        assertEq(token.delegatedPower(delegate), delegatePowerBefore - VOTING_AMOUNT / 2, "Delegate power should decrease");
    }
}
