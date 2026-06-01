// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiSigWallet
 * @notice Multi-signature wallet with reentrancy protection and two-phase execution
 * @dev Fixes:
 *   - OpenZeppelin ReentrancyGuard for battle-tested reentrancy protection
 *   - Two-phase execution: lockConfirmations() then executeTransaction()
 *     prevents front-running by snapshotting confirmations at a prior block
 *   - Zero-address and duplicate validation on owners and transactions
 *   - Transaction existence checks on all state-mutating functions
 *   - require(txId < transactionCount) prevents operations on non-existent txs
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
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;

    // Two-phase execution: snapshot confirmations at a block, execute later
    mapping(uint256 => uint256) public confirmedAtBlock;
    mapping(uint256 => uint256) public confirmedCount;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);
    event ConfirmationsLocked(uint256 indexed txId, uint256 blockNumber, uint256 count);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactionCount, "Transaction does not exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "Already executed");
        _;
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
    function submitTransaction(address to, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256)
    {
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

    function confirmTransaction(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) notExecuted(txId) {
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    /**
     * @notice Get current confirmation count for a transaction
     */
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    /**
     * @notice Phase 1: Lock current confirmations at current block
     * @dev Snapshots confirmations to prevent front-running revocations.
     *      Anyone can call this once confirmations reach threshold.
     */
    function lockConfirmations(uint256 txId) external txExists(txId) notExecuted(txId) {
        uint256 count = getConfirmationCount(txId);
        require(count >= required, "Not enough confirmations");

        confirmedCount[txId] = count;
        confirmedAtBlock[txId] = block.number;

        emit ConfirmationsLocked(txId, block.number, count);
    }

    /**
     * @notice Phase 2: Execute a locked transaction with reentrancy protection
     * @dev Requires confirmations to have been locked first.
     *      Snapshot must be from a prior block to prevent same-block manipulation.
     */
    function executeTransaction(uint256 txId)
        external
        onlyOwner
        txExists(txId)
        notExecuted(txId)
        nonReentrant
    {
        require(confirmedAtBlock[txId] > 0, "Confirmations not locked");
        require(confirmedCount[txId] >= required, "Snapshot below threshold");
        require(block.number > confirmedAtBlock[txId], "Must wait 1+ blocks after lock");

        // Re-verify current confirmations haven't dropped below snapshot
        uint256 currentCount = getConfirmationCount(txId);
        require(currentCount >= required, "Confirmations changed after snapshot");

        Transaction storage txn = transactions[txId];
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
