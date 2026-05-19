// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @notice ERC-20 governance token with delegation and on-chain voting.
 * @dev Security fixes applied (issue #912):
 *   1. Replaced all tx.origin with msg.sender in delegateVote / revokeDelegate
 *   2. Replaced tx.origin admin check with OpenZeppelin Ownable (onlyOwner)
 *   3. Added msg.sender != address(0) guard
 *   4. Delegated voting still works correctly through legitimate contract calls
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

    /**
     * @param initialSupply Total token supply minted to deployer.
     */
    constructor(uint256 initialSupply) ERC20("Governance", "GOV") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /**
     * @notice Delegate voting power to another address.
     * @dev Uses msg.sender (not tx.origin) to prevent phishing attacks where
     *      a malicious contract could delegate a caller's votes without consent.
     * @param to Address to receive delegated voting power.
     */
    function delegateVote(address to) external {
        require(msg.sender != address(0), "Invalid sender");
        require(to != address(0), "Cannot delegate to zero address");
        require(msg.sender != to, "Cannot delegate to self");

        // Remove power from previous delegate (if any)
        address previousDelegate = delegates[msg.sender];
        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= balanceOf(msg.sender);
        }

        // Assign new delegate
        delegates[msg.sender] = to;
        delegatedPower[to] += balanceOf(msg.sender);

        emit DelegateChanged(msg.sender, to);
    }

    /**
     * @notice Revoke current delegation.
     * @dev Uses msg.sender (not tx.origin).
     */
    function revokeDelegate() external {
        require(msg.sender != address(0), "Invalid sender");
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");

        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);

        emit DelegateChanged(msg.sender, address(0));
    }

    /**
     * @notice Admin-only snapshot trigger.
     * @dev Protected by OpenZeppelin Ownable (onlyOwner) instead of tx.origin.
     */
    function snapshot() external onlyOwner {
        // snapshot logic placeholder
    }

    /**
     * @notice Returns total voting power: own balance + delegated power.
     * @param account Address to query.
     * @return Total voting power.
     */
    function getVotingPower(address account) public view returns (uint256) {
        return balanceOf(account) + delegatedPower[account];
    }

    /**
     * @notice Create a new governance proposal.
     * @param description Human-readable proposal text.
     * @param duration Voting window in seconds.
     * @return proposalId Index of the new proposal.
     */
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

    /**
     * @notice Cast a vote on an active proposal.
     * @param proposalId Index of the proposal.
     * @param support True = for, false = against.
     */
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
