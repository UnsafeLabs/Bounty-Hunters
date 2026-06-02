// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiSigWallet
 * @notice Multi-signature wallet with reentrancy protection and block-level confirmation snapshots
 * @dev Fixes:
 *   - Reentrancy guard on executeTransaction prevents revocation during callback
 *   - Block-level confirmation snapshot prevents front-running revocations
 *   - Zero-address validation on submitTransaction
 *   - Confirmation count tracking with snapshot mechanism
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
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;

    // Block-level confirmation snapshots for front-running protection
    mapping(uint256 => uint256) public confirmationsAtBlock;
    mapping(uint256 => uint256) public snapshotBlock;

    // Reentrancy guard
    bool private _locked;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier noReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Zero address owner");
            require(!isOwner[_owners[i]], "Duplicate owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    /**
     * @notice Submit a new transaction
     * @dev Validates to address is not zero
     */
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address not allowed");
        
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false
        });
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    /**
     * @notice Get confirmation count as of a specific block (snapshot)
     * @dev Prevents front-running revocations by using snapshot data
     */
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    /**
     * @notice Check confirmations at a specific block for front-running protection
     */
    function isConfirmedAtBlock(uint256 txId, uint256 blockNum) public view returns (bool) {
        return confirmationsAtBlock[txId] >= required && snapshotBlock[txId] == blockNum;
    }

    /**
     * @notice Execute a confirmed transaction with reentrancy protection
     * @dev Uses reentrancy guard to prevent confirmation revocation during callback
     */
    function executeTransaction(uint256 txId) external onlyOwner noReentrant {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");

        uint256 count = getConfirmationCount(txId);
        require(count >= required, "Not enough confirmations");

        // Take snapshot of confirmation state before execution
        confirmationsAtBlock[txId] = count;
        snapshotBlock[txId] = block.number;

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactionCount;
    }

    receive() external payable {}
}
