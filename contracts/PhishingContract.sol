// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IGovernanceToken {
    function delegateVote(address to) external;
}

/**
 * @title PhishingContract
 * @dev Demonstrates a contract that attempts to delegate votes on behalf of a user
 *      using the old `tx.origin` pattern. After the fix, this contract should have
 *      no effect on the victim's voting power.
 */
contract PhishingContract {
    IGovernanceToken public token;

    constructor(address tokenAddress) {
        token = IGovernanceToken(tokenAddress);
    }

    /**
     * @notice Victim calls this function, thinking it's harmless.
     * @dev The contract forwards the call to `delegateVote`. Prior to the fix,
     *      `delegateVote` used `tx.origin`, allowing the victim's votes to be
     *      hijacked. After the fix, `msg.sender` is the contract, so the delegation
     *      applies to the contract itself (which holds no tokens).
     */
    function attack(address to) external {
        token.delegateVote(to);
    }
}
