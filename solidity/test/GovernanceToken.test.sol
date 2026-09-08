// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

// Malicious contract that attempts phishing
contract PhishingContract {
    GovernanceToken public token;
    address public victim;
    address public fakeDelegate;

    constructor(address _token, address _victim, address _fakeDelegate) {
        token = GovernanceToken(_token);
        victim = _victim;
        fakeDelegate = _fakeDelegate;
    }

    // This would work with tx.origin but fails with msg.sender
    function attack() external {
        // Try to delegate votes on behalf of victim
        // With the fix, this will use msg.sender (this contract) not tx.origin (victim)
        token.delegateVote(fakeDelegate);
    }

    function getVictimDelegate() external view returns (address) {
        return token.delegates(victim);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public admin = address(0x1);
    address public user1 = address(0x2);
    address public user2 = address(0x3);
    address public attacker = address(0x4);

    function setUp() public {
        vm.prank(admin);
        token = new GovernanceToken(1000000e18);
        
        // Transfer tokens to users
        vm.prank(admin);
        token.transfer(user1, 100000e18);
        vm.prank(admin);
        token.transfer(user2, 100000e18);
    }

    function testDelegateVoteUsesMsgSender() public {
        // User1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);
        
        // Check delegation
        assertEq(token.delegates(user1), user2);
        assertEq(token.delegatedPower(user2), 100000e18);
    }

    function testPhishingContractCannotDelegate() public {
        // Deploy phishing contract
        PhishingContract phishing = new PhishingContract(
            address(token), 
            user1, 
            attacker
        );
        
        // Fund phishing contract with some tokens for the attack
        vm.prank(admin);
        token.transfer(address(phishing), 1000e18);
        
        // Attack should fail - phishing contract can only delegate its own votes
        vm.expectRevert("Cannot delegate to self");
        phishing.attack();
        
        // User1's delegate should still be address(0)
        assertEq(token.delegates(user1), address(0));
    }

    function testRevokeDelegate() public {
        // User1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);
        
        // User1 revokes delegation
        vm.prank(user1);
        token.revokeDelegate();
        
        // Check delegation is revoked
        assertEq(token.delegates(user1), address(0));
        assertEq(token.delegatedPower(user2), 0);
    }

    function testSnapshotOnlyOwner() public {
        // Admin can call snapshot
        vm.prank(admin);
        token.snapshot();
        
        // Non-admin cannot call snapshot
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        token.snapshot();
    }

    function testCreateProposal() public {
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 7 days);
        
        assertEq(proposalId, 0);
    }

    function testVote() public {
        // Create proposal
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 7 days);
        
        // User1 votes for
        vm.prank(user1);
        token.vote(proposalId, true);
        
        // User2 votes against
        vm.prank(user2);
        token.vote(proposalId, false);
    }

    function testGetVotingPower() public {
        // User1 has 100000 tokens
        assertEq(token.getVotingPower(user1), 100000e18);
        
        // User1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);
        
        // User2 now has voting power from user1
        assertEq(token.getVotingPower(user2), 200000e18);
    }
}