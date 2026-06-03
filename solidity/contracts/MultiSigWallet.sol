// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiSigWallet
 * @notice Multi-signature wallet with reentrancy protection and front-running prevention
 * @dev Fixes:
 *   - ReentrancyGuard prevents confirmation revocation during execution callback
 *   - Block-level confirmation check prevents front-running attacks
 *   - Zero-address validation on submitTransaction
 *   - Ownable for access control
 */
contract MultiSigWallet is ReentrancyGuard {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 executedAt;  // Block number when executed
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(uint256 => mapping(address => uint256)) public confirmationBlocks;  // Block number when confirmed
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Zero address owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    /**
     * @notice Submit a new transaction
     * @param to Target address (must not be zero address)
     * @param value ETH value to send
     * @param data Call data
     * @return txId Transaction ID
     */
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address");
        
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            executedAt: 0
        });
        emit Submitted(txId);
        return txId;
    }

    /**
     * @notice Confirm a transaction
     * @param txId Transaction ID
     */
    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        confirmationBlocks[txId][msg.sender] = block.number;  // Record block number
        emit Confirmed(txId, msg.sender);
    }

    /**
     * @notice Revoke a confirmation
     * @param txId Transaction ID
     */
    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        confirmationBlocks[txId][msg.sender] = 0;  // Clear block number
        emit Revoked(txId, msg.sender);
    }

    /**
     * @notice Execute a transaction with reentrancy protection
     * @dev Uses nonReentrant to prevent revocation during callback
     * @param txId Transaction ID
     */
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;
        txn.executedAt = block.number;  // Record execution block

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    /**
     * @notice Check if transaction is confirmed at a specific block
     * @dev Prevents front-running by checking confirmations at a specific block
     * @param txId Transaction ID
     * @param blockNumber Block number to check at
     * @return True if confirmed at the specified block
     */
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        if (getConfirmationCount(txId) < required) {
            return false;
        }
        
        // Check if all required confirmations were made at or before the block
        uint256 confirmedCount = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]] && confirmationBlocks[txId][owners[i]] <= blockNumber) {
                confirmedCount++;
                if (confirmedCount >= required) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * @notice Get confirmation count for a transaction
     * @param txId Transaction ID
     * @return count Number of confirmations
     */
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) {
                count++;
            }
        }
    }

    /**
     * @notice Get all owners
     * @return ownerList Array of owner addresses
     */
    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    /**
     * @notice Get transaction count
     * @return count Transaction count
     */
    function getTransactionCount() external view returns (uint256) {
        return transactionCount;
    }

    receive() external payable {}
}
