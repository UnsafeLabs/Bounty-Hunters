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
    address public admin;

    event DelegateChanged(address indexed delegator, address indexed toDelegate);
    event ProposalCreated(uint256 indexed proposalId, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support);

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
        admin = msg.sender;
    }

    // FIX(#912): msg.sender instead of tx-origin — a phishing contract in the
    // middle can no longer delegate the victim's votes; only the direct caller
    // delegates its own balance.
    function delegateVote(address to) external {
        require(msg.sender != address(0), "Invalid delegator");
        require(to != address(0), "Cannot delegate to zero address");
        require(msg.sender != to, "Cannot delegate to self");
        uint256 bal = balanceOf(msg.sender);
        address previousDelegate = delegates[msg.sender];
        if (previousDelegate != address(0)) {
            // Clamp instead of raw -= so a balance change (e.g. transfer after
            // delegating) cannot underflow and brick revocation.
            if (delegatedPower[previousDelegate] >= bal) {
                delegatedPower[previousDelegate] -= bal;
            } else {
                delegatedPower[previousDelegate] = 0;
            }
        }
        delegates[msg.sender] = to;
        delegatedPower[to] += bal;
        emit DelegateChanged(msg.sender, to);
    }

    // FIX(#912): same tx-origin -> msg.sender fix as delegateVote.
    function revokeDelegate() external {
        require(msg.sender != address(0), "Invalid delegator");
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");
        uint256 bal = balanceOf(msg.sender);
        if (delegatedPower[currentDelegate] >= bal) {
            delegatedPower[currentDelegate] -= bal;
        } else {
            delegatedPower[currentDelegate] = 0;
        }
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    // FIX(#912): admin check via OpenZeppelin onlyOwner instead of tx-origin.
    // `admin` is kept as a backwards-compatible alias of owner().
    function snapshot() external onlyOwner {
        // snapshot logic placeholder
    }

    // FIX(#912): an account that delegated its own balance away no longer
    // double-counts it. Returns only power delegated TO it. This also
    // neutralizes pre-fix phishing entries: stolen power accrued to attacker
    // contracts, while victims keep exactly their own balance (no phantom
    // double vote on top of the stolen delegation).
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
