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
    // to the attacker's address. With the fix using msg.sender, this can only
    // delegate the phishing contract's own (zero) balance.
    function trapDelegate(address fakeTarget) external {
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
        vm.prank(user1);
        govToken.delegateVote(user2);
        
        assertEq(govToken.delegates(user1), user2);
        assertEq(govToken.delegatedPower(user2), 1000000 * 10 ** 18);
    }
    
    function test_RevokeDelegateWorks() public {
        vm.prank(user1);
        govToken.delegateVote(user2);
        
        vm.prank(user1);
        govToken.revokeDelegate();
        
        assertEq(govToken.delegates(user1), address(0));
        assertEq(govToken.delegatedPower(user2), 0);
    }
    
    function test_PhanishingContractCannotDelegate() public {
        phishingContract = new PhishingContract(govToken);
        
        vm.prank(address(phishingContract));
        phishingContract.trapDelegate(user2);
        
        assertEq(govToken.delegates(address(phishingContract)), user2);
        assertEq(govToken.delegatedPower(user2), 0);
    }
    
    function test_SnapshotOnlyOwner() public {
        phishingContract = new PhishingContract(govToken);
        
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(address(phishingContract));
        govToken.snapshot();
        
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(user1);
        govToken.snapshot();
        
        vm.prank(address(this));
        govToken.snapshot();
    }
    
    function test_GovernanceVotingWorks() public {
        uint256 proposalId = govToken.createProposal("Test Proposal", 1 days);
        
        vm.prank(user1);
        govToken.delegateVote(user2);
        
        vm.prank(user2);
        govToken.vote(proposalId, true);
        
        (,, uint256 forVotes,,) = govToken.proposals(proposalId);
        assertEq(forVotes, 1000000 * 10 ** 18);
    }
}