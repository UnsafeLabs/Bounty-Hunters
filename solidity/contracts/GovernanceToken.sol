// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

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

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    function delegateVote(address to) external {
        require(msg.sender != address(0), "Invalid delegator");
        require(to != address(0), "Invalid delegate");
        require(msg.sender != to, "Cannot delegate to self");

        address previousDelegate = delegates[msg.sender];
        if (previousDelegate == to) {
            return;
        }

        uint256 votingBalance = balanceOf(msg.sender);
        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= votingBalance;
        }
        delegates[msg.sender] = to;
        delegatedPower[to] += votingBalance;
        emit DelegateChanged(msg.sender, to);
    }

    function revokeDelegate() external {
        require(msg.sender != address(0), "Invalid delegator");

        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");

        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    function snapshot() external onlyOwner {
        // snapshot logic placeholder
    }

    function getVotingPower(address account) public view returns (uint256) {
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

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            address fromDelegate = delegates[from];
            if (fromDelegate != address(0)) {
                delegatedPower[fromDelegate] -= value;
            }
        }

        super._update(from, to, value);

        if (to != address(0)) {
            address toDelegate = delegates[to];
            if (toDelegate != address(0)) {
                delegatedPower[toDelegate] += value;
            }
        }
    }
}
