// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Delegate voting power to another address
    /// @param to The address to delegate votes to
    function delegateVote(address to) external {
        require(to != address(0), "Cannot delegate to zero address");
        require(to != msg.sender, "Cannot delegate to self");
        require(to != address(this), "Cannot delegate to contract");
        address previousDelegate = delegates[msg.sender];
        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= balanceOf(msg.sender);
        }
        delegates[msg.sender] = to;
        delegatedPower[to] += balanceOf(msg.sender);
        emit DelegateChanged(msg.sender, to);
    }

    /// @notice Revoke delegated voting power
    function revokeDelegate() external {
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");
        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    /// @notice Create a governance proposal
    /// @param description The proposal description
    /// @param durationBlocks How many blocks the voting period lasts
    function createProposal(string calldata description, uint256 durationBlocks) external onlyOwner {
        proposals.push(Proposal({
            description: description,
            forVotes: 0,
            againstVotes: 0,
            endTime: block.timestamp + durationBlocks,
            executed: false
        }));
        emit ProposalCreated(proposals.length - 1, description);
    }

    /// @notice Cast a vote on a proposal
    /// @param proposalId The proposal ID
    /// @param support True for for, false for against
    function castVote(uint256 proposalId, bool support) external {
        require(proposalId < proposals.length, "Invalid proposal");
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        require(!proposal.executed, "Proposal executed");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            proposal.forVotes += balanceOf(msg.sender) + delegatedPower[msg.sender];
        } else {
            proposal.againstVotes += balanceOf(msg.sender) + delegatedPower[msg.sender];
        }
        emit VoteCast(proposalId, msg.sender, support);
    }

    /// @notice Get the total voting power for an address (own balance + delegated)
    /// @param addr The address to check
    /// @return uint256 Total voting power
    function getVotingPower(address addr) external view returns (uint256) {
        return balanceOf(addr) + delegatedPower[addr];
    }
}
