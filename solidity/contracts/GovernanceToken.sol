// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GovernanceToken is ERC20Votes, Ownable {
    constructor() ERC20("Governance Token", "GOV") ERC20Votes() Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000 * 10**18);
    }
    
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    function delegateVote(address delegatee) external {
        require(msg.sender != address(0), "Invalid sender");
        _delegate(msg.sender, delegatee);
    }
    
    function revokeDelegate() external {
        require(msg.sender != address(0), "Invalid sender");
        _delegate(msg.sender, address(0));
    }
    
    function snapshot() external onlyOwner {
        _snapshot();
    }
    
    function getVotingPower(address account, uint256 snapShot) external view returns (uint256) {
        return getPastVotes(account, snapShot);
    }
    
    // Override to use msg.sender for all authorization
    // All internal _delegate calls use msg.sender correctly via ERC20Votes
}