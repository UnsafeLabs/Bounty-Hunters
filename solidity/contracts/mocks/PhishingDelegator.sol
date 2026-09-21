// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
    function revokeDelegate() external;
    function delegates(address account) external view returns (address);
}

/// @dev Phishing contract: when a victim calls bait(), this contract tries to
///      delegateVote on GovernanceToken. With tx.origin auth the victim's votes
///      would move; with msg.sender auth only this contract's (empty) power moves.
contract PhishingDelegator {
    IGovernanceToken public token;
    address public attackerDelegate;
    bool public baitCalled;

    constructor(address _token, address _attackerDelegate) {
        token = IGovernanceToken(_token);
        attackerDelegate = _attackerDelegate;
    }

    /// @notice Victim-facing entrypoint that attempts to phish delegation.
    function bait() external {
        baitCalled = true;
        token.delegateVote(attackerDelegate);
    }
}
