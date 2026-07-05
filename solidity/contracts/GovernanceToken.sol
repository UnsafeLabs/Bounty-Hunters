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
    event Snapshot(uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") {
        _mint(msg.sender, initialSupply);
        admin = msg.sender;
    }

    function delegateVote(address to) external {
        address delegator = msg.sender;
        require(delegator != address(0), "Invalid sender");
        require(to != address(0), "Invalid delegate");
        require(delegator != to, "Cannot delegate to self");

        address previousDelegate = delegates[delegator];
        uint256 delegatorBalance = balanceOf(delegator);

        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= delegatorBalance;
        }

        delegates[delegator] = to;
        delegatedPower[to] += delegatorBalance;

        emit DelegateChanged(delegator, to);
    }

    function revokeDelegate() external {
        address delegator = msg.sender;
        require(delegator != address(0), "Invalid sender");

        address currentDelegate = delegates[delegator];
        require(currentDelegate != address(0), "No delegate");

        delegatedPower[currentDelegate] -= balanceOf(delegator);
        delegates[delegator] = address(0);

        emit DelegateChanged(delegator, address(0));
    }

    function snapshot() external onlyOwner {
        emit Snapshot(block.timestamp);
    }

    function getVotingPower(address account) public view returns (uint256) {
        uint256 ownPower = delegates[account] == address(0) ? balanceOf(account) : 0;
        return ownPower + delegatedPower[account];
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

        if (to != address(0)) {
            address toDelegate = delegates[to];
            if (toDelegate != address(0)) {
                delegatedPower[toDelegate] += value;
            }
        }

        super._update(from, to, value);
    }
}
