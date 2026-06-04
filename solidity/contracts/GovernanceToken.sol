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

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Delegate voting power to another address
    /// @param to Address to delegate voting power to
    function delegateVote(address to) external {
        require(msg.sender != address(0), "Invalid sender");
        require(to != address(0), "Cannot delegate to zero address");
        require(to != msg.sender, "Cannot delegate to self");

        address previousDelegate = delegates[msg.sender];
        uint256 balance = balanceOf(msg.sender);

        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= balance;
        }

        delegates[msg.sender] = to;
        delegatedPower[to] += balance;
        emit DelegateChanged(msg.sender, to);
    }

    /// @notice Revoke delegation and return voting power
    function revokeDelegate() external {
        require(msg.sender != address(0), "Invalid sender");
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");

        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    /// @notice Take a snapshot of token balances (admin only)
    function snapshot() external onlyOwner {
        // snapshot logic placeholder
    }

    /// @notice Get total voting power for an account (own balance + delegated)
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
}
