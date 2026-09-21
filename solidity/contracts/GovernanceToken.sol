// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with vote delegation capabilities.
 *      Fixed tx.origin usage to prevent phishing attacks.
 */
contract GovernanceToken is ERC20, Ownable {
    // ------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event SnapshotTaken(uint256 indexed snapshotId);

    // ------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------
    // delegator => delegatee
    mapping(address => address) public delegatee;

    // delegatee => total votes delegated to them
    mapping(address => uint256) public delegatedVotes;

    // Snapshot id counter (simple incrementing counter)
    uint256 private _currentSnapshotId;

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    // ------------------------------------------------------------------------
    // Delegation Functions
    // ------------------------------------------------------------------------
    /**
     * @notice Delegate voting power to `to`.
     * @dev Replaces the insecure `tx.origin` check with `msg.sender`.
     *      Updates delegated vote tallies accordingly.
     */
    function delegateVote(address to) external {
        require(msg.sender != address(0), "GovernanceToken: sender cannot be zero address");

        address previousDelegate = delegatee[msg.sender];
        uint256 senderBalance = balanceOf(msg.sender);

        // Remove previous delegation if any
        if (previousDelegate != address(0)) {
            delegatedVotes[previousDelegate] -= senderBalance;
        }

        // Set new delegate
        delegatee[msg.sender] = to;

        // Add new delegation if not zero address
        if (to != address(0)) {
            delegatedVotes[to] += senderBalance;
        }

        emit DelegateChanged(msg.sender, previousDelegate, to);
    }

    /**
     * @notice Revoke any existing delegation.
     */
    function revokeDelegate() external {
        require(msg.sender != address(0), "GovernanceToken: sender cannot be zero address");

        address previousDelegate = delegatee[msg.sender];
        require(previousDelegate != address(0), "GovernanceToken: no delegate to revoke");

        uint256 senderBalance = balanceOf(msg.sender);
        delegatedVotes[previousDelegate] -= senderBalance;
        delegatee[msg.sender] = address(0);

        emit DelegateChanged(msg.sender, previousDelegate, address(0));
    }

    // ------------------------------------------------------------------------
    // Snapshot Functionality
    // ------------------------------------------------------------------------
    /**
     * @notice Takes a snapshot of the current token balances.
     * @dev Protected by `onlyOwner` instead of the insecure `tx.origin` check.
     */
    function snapshot() external onlyOwner returns (uint256) {
        _currentSnapshotId += 1;
        emit SnapshotTaken(_currentSnapshotId);
        return _currentSnapshotId;
    }

    // ------------------------------------------------------------------------
    // Voting Power Calculation
    // ------------------------------------------------------------------------
    /**
     * @notice Returns the total voting power of `account`.
     * @dev Includes both the account's own token balance and any votes delegated to it.
     */
    function getVotingPower(address account) external view returns (uint256) {
        uint256 ownPower = balanceOf(account);
        uint256 delegatedPower = delegatedVotes[account];
        return ownPower + delegatedPower;
    }

    // ------------------------------------------------------------------------
    // ERC20 Hooks – keep delegated votes in sync on transfers
    // ------------------------------------------------------------------------
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        super._afterTokenTransfer(from, to, amount);

        // Adjust delegated votes when balances change
        if (from != address(0)) {
            address fromDelegate = delegatee[from];
            if (fromDelegate != address(0)) {
                delegatedVotes[fromDelegate] -= amount;
            }
        }

        if (to != address(0)) {
            address toDelegate = delegatee[to];
            if (toDelegate != address(0)) {
                delegatedVotes[toDelegate] += amount;
            }
        }
    }
}
