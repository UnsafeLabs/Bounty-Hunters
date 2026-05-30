// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GovernanceToken.sol";

contract MaliciousDelegate {
    GovernanceToken public token;

    constructor(address _token) {
        token = GovernanceToken(_token);
    }

    function tryPhishDelegate(address to) external {
        token.delegateVote(to);
    }

    function tryPhishRevoke() external {
        token.revokeDelegate();
    }
}
