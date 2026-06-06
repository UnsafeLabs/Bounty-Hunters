// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with delegated voting power for governance proposals.
 */
contract GovernanceToken is ERC20, Ownable {
    struct Delegate {
        address principal;
        uint256 delegatedWeight;
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
     * @param delegatee The address to delegate voting power to.
     */
    function delegateVote(address delegatee) external {
        require(msg.sender != address(0), "Invalid sender");
        require(msg.sender == tx.origin, "No contract delegation");
        address principal = msg.sender;

        require(delegatee != address(0), "Cannot delegate to zero address");
        require(balanceOf(principal) > 0, "No tokens to delegate");
        }));
        uint256 proposalId = proposals.length - 1;
        emit ProposalCreated(proposalId, description);
        return proposalId;
    }

     * @dev Revoke an existing delegation.
     */
    function revokeDelegate() external {
        require(msg.sender != address(0), "Invalid sender");
        require(msg.sender == tx.origin, "No contract revocation");
        address principal = msg.sender;

        require(delegates[principal].principal != address(0), "No active delegation");

        hasVoted[proposalId][msg.sender] = true;
        if (support) {
            proposal.forVotes += power;
        } else {
            proposal.againstVotes += power;
        }
        emit VoteCast(proposalId, msg.sender, support);
    }
    /**
     * @dev Snapshot token balances for proposal voting. Admin only.
     */
    function snapshot() external onlyOwner {
        currentSnapshotId++;
        uint256 newSnapshotId = currentSnapshotId;

    }

    /**
     * @dev Get voting power at current snapshot, accounting for delegations.
     */
    function getVotingPower(address account) external view returns (uint256) {
        uint256 snapshotId = currentSnapshotId;
        uint256 balance = balanceOfAt(account, snapshotId);
        uint256 delegated = delegatedPower[account];

        uint256 ownDelegatedAway = 0;
        if (delegates[account].principal != address(0)) {
            ownDelegatedAway = balanceOfAt(account, snapshotId);
        }

        return balance + delegated - ownDelegatedAway;
    }
}
