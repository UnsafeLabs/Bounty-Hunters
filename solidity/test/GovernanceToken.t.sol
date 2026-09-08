// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GovernanceToken.sol";

contract GovernanceTokenTest {
    GovernanceToken public token;
    address public owner;
    address public user1;
    address public user2;
    address public attacker;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        owner = address(0x1);
        user1 = address(0x2);
        user2 = address(0x3);
        attacker = address(0x4);
        
        token = new GovernanceToken(1000000);
        
        // Mint tokens to users
        token.transfer(user1, 1000);
        token.transfer(user2, 1000);
    }
    
    function testDelegateVote() public {
        vm.prank(user1);
        token.delegateVote(user2);
        
        if (token.delegates(user1) == user2) {
            emit TestPassed("Delegate vote works with msg.sender");
        } else {
            emit TestFailed("Delegate vote failed");
        }
    }
    
    function testCannotDelegateToSelf() public {
        vm.prank(user1);
        try token.delegateVote(user1) {
            emit TestFailed("Should not allow self-delegation");
        } catch {
            emit TestPassed("Cannot delegate to self");
        }
    }
    
    function testRevokeDelegate() public {
        // First delegate
        vm.prank(user1);
        token.delegateVote(user2);
        
        // Then revoke
        vm.prank(user1);
        token.revokeDelegate();
        
        if (token.delegates(user1) == address(0)) {
            emit TestPassed("Revoke delegate works with msg.sender");
        } else {
            emit TestFailed("Revoke delegate failed");
        }
    }
    
    function testSnapshot() public {
        vm.prank(owner);
        try token.snapshot() {
            emit TestPassed("Snapshot works with msg.sender for admin");
        } catch {
            emit TestFailed("Snapshot should work for admin");
        }
    }
    
    function testSnapshotUnauthorized() public {
        vm.prank(user1);
        try token.snapshot() {
            emit TestFailed("Should not allow non-admin to snapshot");
        } catch {
            emit TestPassed("Snapshot rejected for non-admin");
        }
    }
    
    function testPhishingAttackPrevention() public {
        // Deploy a malicious contract that tries to phish using tx.origin
        PhishingContract phishing = new PhishingContract(address(token), user1, user2);
        
        // User1 sends ETH to the phishing contract
        vm.deal(address(phishing), 1);
        
        // Attacker tries to trick user1 into calling the phishing contract
        // which will call delegateVote with tx.origin = user1 but msg.sender = phishing contract
        vm.prank(user1);
        phishing.phishDelegate();
        
        // With the fix, the delegate should NOT be set to user2
        // because msg.sender is the phishing contract, not user1
        if (token.delegates(address(phishing)) == user2) {
            emit TestFailed("Phishing attack succeeded - tx.origin vulnerability exists");
        } else {
            emit TestPassed("Phishing attack prevented - tx.origin vulnerability fixed");
        }
        
        // The real user1 should still be able to delegate
        vm.prank(user1);
        token.delegateVote(user2);
        
        if (token.delegates(user1) == user2) {
            emit TestPassed("Real user can still delegate after phishing prevention");
        } else {
            emit TestFailed("Real user should be able to delegate");
        }
    }
    
    function testPhishingRevokePrevention() public {
        // First, user1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);
        
        // Deploy a malicious contract that tries to phish revoke
        PhishingRevokeContract phishingRevoke = new PhishingRevokeContract(address(token), user1);
        
        vm.deal(address(phishingRevoke), 1);
        
        // Attacker tries to trick user1 into calling the phishing contract
        vm.prank(user1);
        phishingRevoke.phishRevoke();
        
        // With the fix, the delegate should NOT be revoked
        // because msg.sender is the phishing contract, not user1
        if (token.delegates(address(phishingRevoke)) == address(0)) {
            emit TestFailed("Phishing revoke attack succeeded");
        } else {
            emit TestPassed("Phishing revoke attack prevented");
        }
        
        // The real user1 should still be able to revoke
        vm.prank(user1);
        token.revokeDelegate();
        
        if (token.delegates(user1) == address(0)) {
            emit TestPassed("Real user can still revoke after phishing prevention");
        } else {
            emit TestFailed("Real user should be able to revoke");
        }
    }
    
    function testPhishingSnapshotPrevention() public {
        // Deploy a malicious contract that tries to phish snapshot
        PhishingSnapshotContract phishingSnapshot = new PhishingSnapshotContract(address(token), owner);
        
        vm.deal(address(phishingSnapshot), 1);
        
        // Attacker tries to trick owner into calling the phishing contract
        // which will call snapshot with tx.origin = owner but msg.sender = phishing contract
        vm.prank(owner);
        try phishingSnapshot.phishSnapshot() {
            emit TestFailed("Phishing snapshot attack succeeded");
        } catch {
            emit TestPassed("Phishing snapshot attack prevented");
        }
        
        // The real owner should still be able to snapshot
        vm.prank(owner);
        try token.snapshot() {
            emit TestPassed("Real owner can still snapshot after phishing prevention");
        } catch {
            emit TestFailed("Real owner should be able to snapshot");
        }
    }
    
    function testVotingPower() public {
        // User1 delegates to user2
        vm.prank(user1);
        token.delegateVote(user2);
        
        uint256 user2Power = token.getVotingPower(user2);
        
        if (user2Power == 1000) { // user1's balance
            emit TestPassed("Voting power includes delegated power");
        } else {
            emit TestFailed("Voting power calculation incorrect");
        }
    }
    
    function testCreateProposal() public {
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 100);
        
        if (proposalId == 0) {
            emit TestPassed("Create proposal works");
        } else {
            emit TestFailed("Create proposal failed");
        }
    }
    
    function testVote() public {
        // Create a proposal
        vm.prank(user1);
        uint256 proposalId = token.createProposal("Test proposal", 100);
        
        // Vote
        vm.prank(user1);
        token.vote(proposalId, true);
        
        if (token.proposals(proposalId).forVotes > 0) {
            emit TestPassed("Vote works");
        } else {
            emit TestFailed("Vote failed");
        }
    }
}

contract PhishingContract {
    address public token;
    address public target;
    address public toDelegate;
    
    constructor(address _token, address _target, address _toDelegate) {
        token = _token;
        target = _target;
        toDelegate = _toDelegate;
    }
    
    function phishDelegate() external payable {
        GovernanceToken(token).delegateVote(toDelegate);
    }
    
    receive() external payable {}
}

contract PhishingRevokeContract {
    address public token;
    address public target;
    
    constructor(address _token, address _target) {
        token = _token;
        target = _target;
    }
    
    function phishRevoke() external payable {
        GovernanceToken(token).revokeDelegate();
    }
    
    receive() external payable {}
}

contract PhishingSnapshotContract {
    address public token;
    address public target;
    
    constructor(address _token, address _target) {
        token = _token;
        target = _target;
    }
    
    function phishSnapshot() external payable {
        GovernanceToken(token).snapshot();
    }
    
    receive() external payable {}
}
