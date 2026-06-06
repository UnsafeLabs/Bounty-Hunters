// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingContract {
    GovernanceToken public govToken;
    
    constructor(GovernanceToken _govToken) {
        govToken = _govToken;
    }
    
    // This is a malicious contract trying to trick users into delegating their votes
    // to the attacker's address
    function trapDelegate(address fakeTarget) external {
        // Phishing attempt: tries to use msg.sender (the contract) to delegate
        // via the vulnerability, but now it should fail because we use msg.sender correctly
        govToken.delegateVote(fakeTarget);
    }
    
    function trapRevoke() external {
        govToken.revokeDelegate();
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken govToken;
    PhishingContract phishingContract;
    
    address user1 = address(0x1001);
    address user2 = address(0x1002);
    address attacker = address(0xATTAC);
    
    function setUp() public {
        govToken = new GovernanceToken(1000000 * 10 ** 18);
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
    }
    
    function test_DelegateVoteWorks() public {
        // User1 delegates to user2
        vm.prank(user1);
        govToken.delegateVote(user2);
        
        // Check delegation worked
        assertEq(govToken.delegates(user1), user2);
        assertEq(govToken.delegatedPower(user2), 1000000 * 10 ** 18);
    }
    
    function test_RevokeDelegateWorks() public {
        // User1 delegates to user2, then revokes
        vm.prank(user1);
        govToken.delegateVote(user2);
        
        vm.prank(user1);
        govToken.revokeDelegate();
        
        assertEq(govToken.delegates(user1), address(0));
        assertEq(govToken.delegatedPower(user2), 0);
    }
    
    function test_PhanishingContractCannotDelegate() public {
        // Deploy phishing contract
        phishingContract = new PhishingContract(govToken);
        
        // The phishing contract tries to delegate on behalf of user1
        // but now with the fix, it can only delegate its own (zero) balance
        vm.prank(user1);
        govToken.delegateVote(attacker);
        
        // The phishing contract tries to trick user1, but user1's delegation
        // is already to attacker, so this tests the msg.sender protection
        vm.prank(address(phishingContract));
        phishingContract.trapDelegate(user2);
        
        // The phishing contract itself has no balance, so delegation should have no effect
        assertEq(govToken.delegates(address(phishingContract)), user2);
        assertEq(govToken.delegatedPower(user2), 0);
    }
    
    function test_SnapshotOnlyOwner() public {
        // Deploy phishing contract first
        phishingContract = new PhishingContract(govToken);
        
        // Phishing contract cannot call snapshot
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(address(phishingContract));
        govToken.snapshot();
        
        // Non-owner also cannot call snapshot
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(user1);
        govToken.snapshot();
        
        // Owner can call snapshot
        vm.prank(address(this));
        govToken.snapshot();
    }
    
    function test_GovernanceVotingWorks() public {
        // Create a proposal
        uint256 proposalId = govToken.createProposal("Test Proposal", 1 days);
        
        // User1 delegates to user2 for voting power
        vm.prank(user1);
        govToken.delegateVote(user2);
        
        // User2 votes with delegated power
        vm.prank(user2);
        govToken.vote(proposalId, true);
        
        // Check vote was counted
        (,, uint256 forVotes,,) = govToken.proposals(proposalId);
        assertEq(forVotes, 1000000 * 10 ** 18);
    }
}