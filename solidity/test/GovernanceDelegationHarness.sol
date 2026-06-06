// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
}

contract PhishingDelegate {
    function trick(address token, address attackerDelegate) external {
        IGovernanceToken(token).delegateVote(attackerDelegate);
    }
}

contract ContractWalletDelegate {
    function delegate(address token, address delegatee) external {
        IGovernanceToken(token).delegateVote(delegatee);
    }
}
