// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @notice ERC-20 governance token with delegation and proposal voting
 * @dev Fixes:
 *   - All tx.origin replaced with msg.sender (prevents phishing)
 *   - Admin check uses Ownable modifier instead of tx.origin
 *   - Zero-address guards on delegation
 *   - Delegated power tracking on token transfers
 *   - Delegator cannot vote after delegating (prevents double-voting)
 */
contract GovernanceToken is ERC20, Ownable {
    mapping(address => address) public delegates;
    mapping(address => uint256) public delegatedPower;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    // Track who has delegated to prevent double-voting
    mapping(address => bool) public hasDelegated;

    struct Proposal {
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 endTime;
        bool executed;
    }

    Proposal[] public proposals;

    event DelegateChanged(address indexed delegator, address indexed toDelegate);
    event ProposalCreated(uint256 indexed proposalId, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support);

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /**
     * @notice Override _update to track delegated power on transfers
     */
    function _update(address from, address to, uint256 value) internal override {
        // Remove delegated power from sender's delegate
        if (from != address(0) && delegates[from] != address(0)) {
            delegatedPower[delegates[from]] -= value;
        }
        
        super._update(from, to, value);
        
        // Add delegated power to receiver's delegate
        if (to != address(0) && delegates[to] != address(0)) {
            delegatedPower[delegates[to]] += value;
        }
    }

    /**
     * @notice Delegate voting power to another address
     * @dev Uses msg.sender (not tx.origin) to prevent phishing attacks
     */
    function delegateVote(address to) external {
        require(to != address(0), "Cannot delegate to zero address");
        require(to != msg.sender, "Cannot delegate to self");

        address previousDelegate = delegates[msg.sender];
        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= balanceOf(msg.sender);
        }

        delegates[msg.sender] = to;
        delegatedPower[to] += balanceOf(msg.sender);
        hasDelegated[msg.sender] = true;

        emit DelegateChanged(msg.sender, to);
    }

    /**
     * @notice Revoke current delegation
     */
    function revokeDelegate() external {
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");

        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        hasDelegated[msg.sender] = false;

        emit DelegateChanged(msg.sender, address(0));
    }

    /**
     * @notice Take a snapshot of current token state (admin only)
     */
    function snapshot() external onlyOwner {
        // snapshot logic placeholder
    }

    /**
     * @notice Get total voting power including delegated power
     * @dev Delegators cannot vote with their own balance after delegating
     */
    function getVotingPower(address account) public view returns (uint256) {
        uint256 ownPower = balanceOf(account);
        uint256 delegated = delegatedPower[account];
        
        // If this account has delegated their own tokens, don't count them
        // (they vote through their delegate, not themselves)
        if (hasDelegated[account]) {
            // Only count delegated power from others, not own balance
            return delegated;
        }
        
        return ownPower + delegated;
    }

    function createProposal(string calldata description, uint256 duration) external returns (uint256) {
        require(duration > 0, "Duration must be > 0");
        proposals.push(Proposal({
            description: description,
            forVotes: 0,
            againstVotes: 0,
            endTime: block.timestamp + duration,
            executed: false
        }));
        uint256 proposalId = proposals.length - 1;
        emit ProposalCreated(proposalId, description);
        return proposalId;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint256 power = getVotingPower(msg.sender);
        require(power > 0, "No voting power");

        hasVoted[proposalId][msg.sender] = true;
        if (support) {
            proposal.forVotes += power;
        } else {
            proposal.againstVotes += power;
        }
        emit VoteCast(proposalId, msg.sender, support);
    }
}
