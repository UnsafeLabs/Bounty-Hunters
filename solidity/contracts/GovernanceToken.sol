// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GovernanceToken is ERC20 {
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
    address public admin;

    event DelegateChanged(address indexed delegator, address indexed toDelegate);
    event ProposalCreated(uint256 indexed proposalId, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support);

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") {
        _mint(msg.sender, initialSupply);
        admin = msg.sender;
    }

    // BUG: Uses tx.origin instead of msg.sender — phishing vulnerability
    function delegateVote(address to) external {
        require(tx.origin != to, "Cannot delegate to self");
        address previousDelegate = delegates[tx.origin];
        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= balanceOf(tx.origin);
        }
        delegates[tx.origin] = to;
        delegatedPower[to] += balanceOf(tx.origin);
        emit DelegateChanged(tx.origin, to);
    }

    // BUG: Same tx.origin issue
    function revokeDelegate() external {
        address currentDelegate = delegates[tx.origin];
        require(currentDelegate != address(0), "No delegate");
        delegatedPower[currentDelegate] -= balanceOf(tx.origin);
        delegates[tx.origin] = address(0);
        emit DelegateChanged(tx.origin, address(0));
    }

    // BUG: tx.origin for admin check
    function snapshot() external {
        require(tx.origin == admin, "Not admin");
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
}
