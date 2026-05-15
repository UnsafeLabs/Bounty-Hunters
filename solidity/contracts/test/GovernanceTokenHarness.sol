// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../GovernanceToken.sol";

contract GovernanceTokenPhishing {
    GovernanceToken private immutable token;

    constructor(GovernanceToken token_) {
        token = token_;
    }

    function phishDelegate(address to) external {
        token.delegateVote(to);
    }

    function phishSnapshot() external {
        token.snapshot();
    }
}

contract GovernanceTokenDelegationWallet {
    GovernanceToken private immutable token;

    constructor(GovernanceToken token_) {
        token = token_;
    }

    function delegateTo(address to) external {
        token.delegateVote(to);
    }
}
