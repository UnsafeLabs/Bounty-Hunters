// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GovernanceToken.sol";

contract MaliciousSnapshot {
    GovernanceToken public token;

    constructor(address _token) {
        token = GovernanceToken(_token);
    }

    function tryPhishSnapshot() external {
        token.snapshot();
    }
}
