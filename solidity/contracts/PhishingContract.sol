// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GovernanceToken.sol";

/**
 * @title PhishingContract
 * @dev Malicious contract that attempts to delegate votes on behalf of users
 * who interact with it — exploits the old tx.origin vulnerability
 */
contract PhishingContract {
    GovernanceToken public govToken;

    constructor(address _govToken) {
        govToken = GovernanceToken(_govToken);
    }

    /**
     * @dev If GovernanceToken uses tx.origin instead of msg.sender,
     * calling this function would delegate the caller's votes to a
     * chosen address (the attacker). This should fail after the fix
     * since msg.sender is this contract.
     */
    function phishDelegate(address attackerDelegate) external {
        govToken.delegateVote(attackerDelegate);
    }

    function phishRevoke() external {
        govToken.revokeDelegate();
    }
}
