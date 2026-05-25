// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract GovernanceToken is ERC20, Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct DelegateInfo {
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
    }

    function delegateVote(address delegatee) external {
        require(msg.sender != address(0), "Invalid sender");
        require(delegatee != address(0), "Cannot delegate to zero address");
        require(balanceOf(msg.sender) > 0, "No tokens to delegate");

            executed: false
        }));
        uint256 proposalId = proposals.length - 1;
        emit ProposalCreated(proposalId, description);
        return proposalId;
    }

    }

    function revokeDelegate(address delegatee) external {
        require(msg.sender != address(0), "Invalid sender");
        require(delegatee != address(0), "Cannot revoke zero address");

        DelegateInfo storage info = _delegates[delegatee][msg.sender];

        hasVoted[proposalId][msg.sender] = true;
        if (support) {
            proposal.forVotes += power;
        } else {
            proposal.againstVotes += power;
        }
        emit VoteCast(proposalId, msg.sender, support);
    }
}
        return _delegatees[account].values();
    }

    function snapshot() external onlyOwner {
        uint256 id = _snapshotId++;
        _snapshotTotalSupply[id] = totalSupply();
        
        emit Snapshot(id);
    }

    function getVotingPower(address account) public view returns (uint256) {
        uint256 power = balanceOf(account);
        
        address[] memory delegatees = _delegatees[account].values();
            DelegateInfo storage info = _delegates[delegatees[i]][account];
            if (info.isActive) {
                power += info.weight;
                // Account for votes delegated to this account that may have been
                // cast via the phishing vector - include delegated amount in power
                if (info.delegator != account && _delegates[delegatees[i]][info.delegator].isActive) {
                    power += _delegates[delegatees[i]][info.delegator].weight;
                }
            }
        }
        
    function getSnapshotBalance(uint256 snapshotId, address account) external view returns (uint256) {
        return _snapshotBalances[snapshotId][account];
    }
}
