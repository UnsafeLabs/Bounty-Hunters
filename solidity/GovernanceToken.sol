// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GovernanceToken is ERC20, Ownable {
    mapping(address => address) public delegates;
    mapping(address => uint256) public delegatedVotes;

    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    );

    constructor() ERC20("GovToken", "GOV") {
        _mint(msg.sender, 1000000 * 10**decimals());
    }

    // Fix for #912: Replaced tx.origin with msg.sender to prevent phishing
    function delegateVote(address delegatee) public {
        require(msg.sender != address(0), "invalid sender");
        require(delegatee != address(0), "invalid delegatee");

        address currentDelegate = delegates[msg.sender];
        uint256 amount = balanceOf(msg.sender);

        if (currentDelegate != address(0)) {
            delegatedVotes[currentDelegate] -= amount;
        }

        delegates[msg.sender] = delegatee;
        delegatedVotes[delegatee] += amount;

        emit DelegateChanged(msg.sender, currentDelegate, delegatee);
    }

    // Fix for #912: Replaced tx.origin with msg.sender
    function revokeDelegate() public {
        require(msg.sender != address(0), "invalid sender");
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "no delegate to revoke");

        uint256 amount = balanceOf(msg.sender);
        delegatedVotes[currentDelegate] -= amount;
        delegates[msg.sender] = address(0);

        emit DelegateChanged(msg.sender, currentDelegate, address(0));
    }

    // Fix for #912: Replaced tx.origin == owner with onlyOwner modifier
    function snapshot() public onlyOwner {
        // Mock snapshot logic
    }

    // Fix for #912: Correctly calculate voting power (cannot double vote if delegated)
    function getVotingPower(address account) public view returns (uint256) {
        uint256 balance = 0;
        // If they haven't delegated their own tokens, they can vote with them
        if (delegates[account] == address(0)) {
            balance = balanceOf(account);
        }
        
        return balance + delegatedVotes[account];
    }
}
