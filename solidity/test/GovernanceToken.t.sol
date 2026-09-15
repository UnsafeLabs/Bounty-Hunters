// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

/// @notice Simulates the #912 attack: a victim is lured into calling this
/// contract, which forwards a delegation to the token. Pre-fix the token
/// recorded tx.origin (the victim) and stole their votes; post-fix only the
/// forwarder's own (zero) balance is delegated.
contract PhishingForwarder {
    GovernanceToken public token;
    address public attacker;

    constructor(GovernanceToken _token, address _attacker) {
        token = _token;
        attacker = _attacker;
    }

    function lure() external {
        token.delegateVote(attacker);
    }
}

/// @notice A legitimate contract wallet holding its own tokens. It calls the
/// token directly, so msg.sender == the wallet and delegation must succeed —
/// the fix blocks spoofed delegation, not contracts acting for themselves.
contract ContractWallet {
    GovernanceToken public token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function delegate(address to) external {
        token.delegateVote(to);
    }
}

contract GovernanceTokenTest is Test {
    GovernanceToken public token;
    address public victim = address(0xBEEF);
    address public userA = address(0xA11CE);
    address public delegateeB = address(0xB0B);
    address public attacker = address(0xBAD);

    function setUp() public {
        token = new GovernanceToken();
        token.transfer(victim, 1_000);
        token.transfer(userA, 1_000);
        token.transfer(delegateeB, 500);
    }

    function testDirectDelegationWorks() public {
        vm.prank(userA);
        token.delegateVote(delegateeB);

        assertEq(token.delegates(userA), delegateeB);
        assertEq(token.delegatedPower(delegateeB), 1_000);
        // Delegator gave its power away: no double count.
        assertEq(token.getVotingPower(userA), 0);
        assertEq(token.getVotingPower(delegateeB), 1_500);
    }

    function testPhishingContractCannotStealVictimVotes() public {
        PhishingForwarder forwarder = new PhishingForwarder(token, attacker);

        // Victim is tricked into calling the malicious contract.
        vm.prank(victim);
        forwarder.lure();

        // Victim's delegation slot untouched; attacker gained nothing.
        assertEq(token.delegates(victim), address(0));
        assertEq(token.delegatedPower(attacker), 0);
        assertEq(token.getVotingPower(victim), 1_000);
        assertEq(token.getVotingPower(attacker), 0);
    }

    function testLegitimateContractWalletCanDelegate() public {
        ContractWallet wallet = new ContractWallet(token);
        token.transfer(address(wallet), 300);

        wallet.delegate(delegateeB);

        assertEq(token.delegates(address(wallet)), delegateeB);
        assertEq(token.delegatedPower(delegateeB), 300);
        assertEq(token.getVotingPower(address(wallet)), 0);
    }

    function testTransferSyncsDelegatedPower() public {
        vm.prank(userA);
        token.delegateVote(delegateeB);

        vm.prank(userA);
        token.transfer(victim, 400);

        assertEq(token.delegatedPower(delegateeB), 600);
        assertEq(token.getVotingPower(delegateeB), 1_100);
    }

    function testSnapshotOnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        token.snapshot();

        // Owner (deployer) still works.
        assertEq(token.snapshot(), token.totalSupply());
    }

    function testCannotDelegateToSelfOrZero() public {
        vm.prank(userA);
        vm.expectRevert("Cannot delegate to self");
        token.delegateVote(userA);

        vm.prank(userA);
        vm.expectRevert("Cannot delegate to zero address");
        token.delegateVote(address(0));
    }
}
