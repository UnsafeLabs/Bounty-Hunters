// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @notice ERC-20 governance token with msg.sender-based delegation (auth uses caller, not transaction origin).
 * @dev Admin functions gated by OpenZeppelin Ownable. Voting power excludes
 *      balances that have been delegated away to avoid double-counting.
 */
contract GovernanceToken is ERC20, Ownable {
    mapping(address => address) public delegates;
    mapping(address => uint256) public delegatedPower;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

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
    event Snapshot(address indexed triggeredBy);

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Delegate voting power of msg.sender to `to`.
    function delegateVote(address to) external {
        require(msg.sender != address(0), "Zero sender");
        require(to != address(0), "Zero delegate");
        require(msg.sender != to, "Cannot delegate to self");

        address previousDelegate = delegates[msg.sender];
        uint256 amount = balanceOf(msg.sender);

        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= amount;
        }

        delegates[msg.sender] = to;
        delegatedPower[to] += amount;
        emit DelegateChanged(msg.sender, to);
    }

    /// @notice Revoke an existing delegation for msg.sender.
    function revokeDelegate() external {
        require(msg.sender != address(0), "Zero sender");
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");

        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    /// @notice Admin snapshot hook — owner only (replaces origin-based admin check).
    function snapshot() external onlyOwner {
        emit Snapshot(msg.sender);
    }

    /**
     * @notice Voting power for `account`.
     * @dev If the account has delegated away, only received delegatedPower counts
     *      (own balance is attributed to the delegatee). Otherwise balance +
     *      received delegatedPower. Prevents double-counting for both phishing-era incorrect
     *      attributions and legitimate delegation.
     */
    function getVotingPower(address account) public view returns (uint256) {
        if (delegates[account] != address(0)) {
            return delegatedPower[account];
        }
        return balanceOf(account) + delegatedPower[account];
    }

    function createProposal(string calldata description, uint256 duration) external returns (uint256) {
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
