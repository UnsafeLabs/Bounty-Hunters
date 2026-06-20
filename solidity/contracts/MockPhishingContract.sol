// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPhishingContract {
    IERC20 public token;
    address public attacker;

    constructor(address _token) {
        token = IERC20(_token);
        attacker = msg.sender;
    }

    function delegateVote(address to) external {
        // This tries to delegate votes on behalf of the caller
        // In a real attack, this would be done via a malicious contract interaction
        // The fix ensures msg.sender is used instead of tx.origin
        token.transfer(attacker, 0);
    }
}
