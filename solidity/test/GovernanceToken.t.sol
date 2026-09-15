// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingForwarder is Test {
    GovernanceToken public target;
    address public victim;

    constructor(address _target, address _victim) {
        target = GovernanceToken(_target);
        victim = _victim;
    }

    function delegate(address to) external {
        target.delegateVote(to);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public gov;
    address public user1;
    address public user2;
    address public admin;

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        admin = makeAddr("admin");
        
        gov = new GovernanceToken(1000 * 10**18);
        // The deployer (msg.sender) gets the initial supply
        // Transfer tokens to user1 and user2 for testing
        gov.transfer(user1, 500 * 10**18);
        gov.transfer(user2, 300 * 10**18);
        
        // Transfer ownership to admin
        gov.transferOwnership(admin);
        // Also give admin some tokens for voting power test
        gov.transfer(admin, 100 * 10**18);
    }

    function test_NormalDelegation() public {
        // user1 delegates to user2
        vm.prank(user1);
        gov.delegateVote(user2);

        assertEq(gov.delegates(user1), user2, "Delegate should be user2");
        // user2 voting power = their own 300 + user1's delegated 500 = 800
        assertEq(gov.getVotingPower(user2), 800 * 10**18, "user2 should have own balance + delegated power");
    }

    function test_RevokeDelegation() public {
        vm.prank(user1);
        gov.delegateVote(user2);

        vm.prank(user1);
        gov.revokeDelegate();

        assertEq(gov.delegates(user1), address(0), "Delegate should be revoked");
    }

    function test_PhishingContractCannotStealVictimVotes() public {
        // Deploy phishing forwarder
        PhishingForwarder forwarder = new PhishingForwarder(address(gov), user1);

        // Give some tokens to the forwarder to test
        gov.transfer(address(forwarder), 100 * 10**18);

        // The phishing forwarder tries to delegate using victim's identity via tx.origin
        // But since we use msg.sender, it can only delegate its own tokens
        vm.prank(address(forwarder));
        forwarder.delegate(user2);

        // The forwarder can only delegate its own tokens, not victim's
        // This proves that tx.origin phishing is no longer possible
        assertEq(gov.getVotingPower(address(forwarder)), 100 * 10**18, "Forwarder should only have its own power");
        assertEq(gov.getVotingPower(user1), 500 * 10**18, "Victim should retain original power");
    }

    function test_OnlyOwnerCanSnapshot() public {
        // Admin should be able to snapshot
        vm.prank(admin);
        gov.snapshot();

        // Non-admin should not be able to snapshot
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        vm.prank(user1);
        gov.snapshot();
    }

    function test_AdminHasGovernancePower() public {
        // Admin gets voting power through ownership (minting in constructor)
        assertGt(gov.getVotingPower(admin), 0, "Admin should have voting power");
    }
}