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

    function delegateVote(address to) external {
        require(msg.sender != to, "Cannot delegate to self");
        address previousDelegate = delegates[msg.sender];
        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= balanceOf(msg.sender);
        }
        delegates[msg.sender] = to;
        delegatedPower[to] += balanceOf(msg.sender);
        emit DelegateChanged(msg.sender, to);
    }

    function revokeDelegate() external {
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");
        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    function snapshot() external {
        require(msg.sender == admin, "Not admin");
    }

    function getVotingPower(address account) public view returns (uint256) {
        return balanceOf(account) + delegatedPower[account];
    }
}
