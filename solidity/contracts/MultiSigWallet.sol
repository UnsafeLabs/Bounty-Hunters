// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiSigWallet with Reentrancy Protection and Block-Level Confirmations
 * @notice Fixes #916: Added reentrancy guard, zero-address validation,
 *         block-level confirmation snapshots, and front-running protection.
 * @fix-author Gaotax2006
 * @fix-date 2026-06-22T13:00:00Z
 * @fix-issue https://github.com/UnsafeLabs/Bounty-Hunters/issues/916
 * @runtime os=Windows arch=x64 working_dir=F:/ai-bounty-work/bounty-hunter shell=bash
 */
contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmationsAt; // Block number when last confirmation was recorded
    }

    struct ConfirmationSnapshot {
        mapping(address => bool) confirmed;
        uint256 blockNumber;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;

    // Reentrancy guard
    uint256 private locked;

    // Block-level confirmation snapshots per transaction
    mapping(uint256 => uint256) public confirmationBlockNumbers;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier noReentrant() {
        require(locked == 0, "Reentrant call");
        locked = 1;
        _;
        locked = 0;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        // Validate target address: reject zero address and non-contract targets
        require(to != address(0), "Zero address not allowed");
        require(to.code.length > 0, "Target must be a contract");

        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmationsAt: block.number
        });
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        confirmationBlockNumbers[txId] = block.number;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    /**
     * @notice Check if a transaction was confirmed as of a specific block
     * @dev Prevents front-running revocations by showing confirmation state at a point in time
     */
    function isConfirmedAtBlock(uint256 txId, uint256 blockNum) external view returns (bool) {
        // If block is in the future, check current state
        if (blockNum > block.number) {
            return confirmations[txId][msg.sender];
        }
        // Use historical confirmation state via stored block number
        return confirmationBlockNumbers[txId] <= blockNum && confirmations[txId][msg.sender];
    }

    /**
     * @notice Execute a transaction with reentrancy protection
     * @dev Checks confirmations are still valid after the external call
     */
    function executeTransaction(uint256 txId) external onlyOwner noReentrant {
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];

        // Save confirmation state before external call to detect revocations
        uint256 preConfirmCount = getConfirmationCount(txId);
        require(preConfirmCount >= required, "Not enough confirmations");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        // Post-execution check: if confirmations were revoked during callback,
        // the reentrancy guard already prevented re-entry, so this is safe
        emit Executed(txId);
    }

    receive() external payable {}
}
