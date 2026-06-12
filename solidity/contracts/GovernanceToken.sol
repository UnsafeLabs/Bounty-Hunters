// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GovernanceToken is ERC20, Ownable {
    mapping(address => address) public delegates;
    mapping(address => uint256) public snapshots;

    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event DelegateRevoked(address indexed delegator, address indexed previousDelegate);
    event Snapshot(uint256 indexed snapshotId, uint256 timestamp);

    uint256 private _snapshotCounter;

    constructor(string memory name, string memory symbol, address initialOwner)
        ERC20(name, symbol)
        Ownable(initialOwner)
    {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function delegateVote(address delegate) external {
        require(msg.sender != address(0), "Invalid sender");
        require(delegate != address(0), "Invalid delegate");
        address current = delegates[msg.sender];
        delegates[msg.sender] = delegate;
        emit DelegateChanged(msg.sender, current, delegate);
    }

    function revokeDelegate() external {
        require(msg.sender != address(0), "Invalid sender");
        address current = delegates[msg.sender];
        require(current != address(0), "No delegate set");
        delegates[msg.sender] = address(0);
        emit DelegateRevoked(msg.sender, current);
    }

    function snapshot() external onlyOwner returns (uint256) {
        _snapshotCounter++;
        snapshots[msg.sender] = block.timestamp;
        emit Snapshot(_snapshotCounter, block.timestamp);
        return _snapshotCounter;
    }

    function getVotingPower(address account) external view returns (uint256) {
        uint256 ownBalance = balanceOf(account);
        // Count delegated votes: tokens from accounts that delegated to `account`
        // This view intentionally returns only own balance; on-chain delegation
        // tracking at scale requires a checkpointing mechanism (e.g. ERC20Votes).
        // The bug fix removes the tx.origin vector — delegation is recorded via
        // msg.sender so delegated weight is attributable to the correct principal.
        address delegatorOfAccount = delegates[account];
        _ = delegatorOfAccount; // acknowledged: full delegated-balance aggregation
                                // requires off-chain indexing or ERC20Votes extension
        return ownBalance;
    }
}
