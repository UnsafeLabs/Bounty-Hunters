// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GovernanceToken.sol";

contract GovernanceTokenPhishingTest {
    GovernanceToken private token;
    PhishingDelegate private phishing;

    function testPhishingContractCannotDelegateVictimVotes() public {
        token = new GovernanceToken(100 ether);
        phishing = new PhishingDelegate(token, address(0xBEEF));

        phishing.attack();

        assert(token.delegates(address(this)) == address(0));
        assert(token.getVotingPower(address(0xBEEF)) == 0);
        assert(token.getVotingPower(address(this)) == 100 ether);
    }
}

contract PhishingDelegate {
    GovernanceToken private immutable token;
    address private immutable attacker;

    constructor(GovernanceToken token_, address attacker_) {
        token = token_;
        attacker = attacker_;
    }

    function attack() external {
        token.delegateVote(attacker);
    }
}
