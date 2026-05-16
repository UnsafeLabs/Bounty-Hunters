// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/GovernanceToken.sol";

contract PhishingDelegate {
    GovernanceToken public immutable token;

    constructor(GovernanceToken _token) {
        token = _token;
    }

    function attack(address delegatee) external {
        token.delegateVote(delegatee);
    }
}

contract GovernanceTokenPhishingTest is Test {
    GovernanceToken private token;
    PhishingDelegate private phishing;

    address private owner = address(0xA11CE);
    address private victim = address(0xB0B);
    address private attacker = address(0xE1);

    function setUp() public {
        vm.prank(owner);
        token = new GovernanceToken(1_000 ether);
        phishing = new PhishingDelegate(token);

        vm.prank(owner);
        token.transfer(victim, 100 ether);
    }

    function testPhishingContractCannotDelegateVictimVotes() public {
        vm.prank(victim);
        phishing.attack(attacker);

        assertEq(token.delegates(victim), address(0));
        assertEq(token.delegates(address(phishing)), attacker);
        assertEq(token.delegatedPower(attacker), 0);
        assertEq(token.getVotingPower(victim), 100 ether);
        assertEq(token.getVotingPower(attacker), 0);
    }

    function testContractCanDelegateItsOwnVotes() public {
        vm.prank(owner);
        token.transfer(address(phishing), 25 ether);

        vm.prank(victim);
        phishing.attack(attacker);

        assertEq(token.delegates(address(phishing)), attacker);
        assertEq(token.delegatedPower(attacker), 25 ether);
        assertEq(token.getVotingPower(address(phishing)), 0);
        assertEq(token.getVotingPower(attacker), 25 ether);
    }
}
