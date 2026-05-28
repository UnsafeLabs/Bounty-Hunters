// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GovernanceToken.sol";

contract PhishingAttack {
    GovernanceToken public token;
    address public attacker;

    constructor(address _token, address _attacker) {
        token = GovernanceToken(_token);
        attacker = _attacker;
    }

    fallback() external payable {
        // Attack: attempt to delegate to attacker
        token.delegateVote(attacker);
    }
}

contract GovernancePhishingTest {
    GovernanceToken public token;
    PhishingAttack public attackContract;
    address public victim = address(0x1111);
    address public attacker = address(0x2222);

    constructor() {
        token = new GovernanceToken(1000 * 10**18);
        attackContract = new PhishingAttack(address(token), attacker);
    }

    function testPhishingFails() public {
        // Simulating the victim interacting with the attack contract
        // The victim sends 0 ether to trigger the fallback which tries to delegate
        (bool success, ) = address(attackContract).call{value: 0}("");
        require(success, "Attack execution failed");

        // The attack should not delegate the victim's voting power
        // The victim's delegate should remain address(0)
        assert(token.delegates(victim) == address(0));
        
        // Instead, the attackContract itself delegates to the attacker
        assert(token.delegates(address(attackContract)) == attacker);
    }
}
