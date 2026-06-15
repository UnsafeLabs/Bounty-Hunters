// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GovernanceToken.sol";

contract PhishingProxy {
    GovernanceToken public governanceToken;

    constructor(address _governanceToken) {
        governanceToken = GovernanceToken(_governanceToken);
    }

    // Attempt to delegate victim's votes to attacker via phishing
    function phishDelegate(address attacker) external {
        governanceToken.delegateVote(attacker);
    }

    // Attempt to revoke victim's delegation
    function phishRevoke() external {
        governanceToken.revokeDelegate();
    }

    // Attempt to call snapshot as non-admin via phishing
    function phishSnapshot() external {
        governanceToken.snapshot();
    }
}
