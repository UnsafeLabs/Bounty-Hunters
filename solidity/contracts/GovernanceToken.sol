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

    function delegateVote(address to) external {
        require(msg.sender != address(0), "Zero address");
        require(msg.sender != to, "Cannot delegate to self");
        address previous = delegates[msg.sender];
        if (previous != address(0)) { delegatedPower[previous] -= balanceOf(msg.sender); }
        delegates[msg.sender] = to;
        delegatedPower[to] += balanceOf(msg.sender);
        emit DelegateChanged(msg.sender, to);
    }

    function revokeDelegate() external {
        require(msg.sender != address(0), "Zero address");
        address current = delegates[msg.sender];
        require(current != address(0), "No delegate");
        delegatedPower[current] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    function snapshot() external onlyOwner {}

    function getVotingPower(address account) public view returns (uint256) {
        return balanceOf(account) + delegatedPower[account];
    }

    function createProposal(string calldata description, uint256 duration) external returns (uint256) {
        proposals.push(Proposal({
            description: description, forVotes: 0, againstVotes: 0,
            endTime: block.timestamp + duration, executed: false
        }));
        uint256 id = proposals.length - 1;
        emit ProposalCreated(id, description);
        return id;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.endTime, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        uint256 power = getVotingPower(msg.sender);
        require(power > 0, "No voting power");
        hasVoted[proposalId][msg.sender] = true;
        if (support) { p.forVotes += power; } else { p.againstVotes += power; }
        emit VoteCast(proposalId, msg.sender, support);
    }
}
