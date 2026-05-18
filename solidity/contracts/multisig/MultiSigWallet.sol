// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiSigWallet
 * @notice Fix: Confirmation race condition during execution callback (#916)
 *
 * Problem: During execution, external calls can re-enter confirmTransaction,
 * allowing the same signer to confirm multiple times, bypassing threshold.
 *
 * Solution: ReentrancyGuard + confirmation state locked during execution,
 * use checks-effects-interactions pattern, emit events after state changes.
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MultiSigWallet is ReentrancyGuard {
    struct Transaction {
        address destination;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmationCount;
    }

    // Track confirmations: txIndex => owner => confirmed
    mapping(uint256 => mapping(address => bool)) public confirmations;

    // Track if owner is valid
    mapping(address => bool) public isOwner;
    address[] public owners;
    uint256 public requiredConfirmations;

    Transaction[] public transactions;

    // Execution lock — prevents re-entrancy at confirmation level
    bool private _executing;

    event TransactionSubmitted(uint256 indexed txIndex, address indexed submitter);
    event TransactionConfirmed(uint256 indexed txIndex, address indexed confirmer);
    event TransactionExecuted(uint256 indexed txIndex);
    event ExecutionFailed(uint256 indexed txIndex);
    event ConfirmationRevoked(uint256 indexed txIndex, address indexed revoker);

    error NotOwner(address caller);
    error TxNotFound(uint256 txIndex);
    error TxAlreadyExecuted(uint256 txIndex);
    error TxAlreadyConfirmed(uint256 txIndex, address confirmer);
    error TxNotConfirmed(uint256 txIndex, address confirmer);
    error InsufficientConfirmations(uint256 txIndex, uint256 current, uint256 required);
    error ExecutionLocked();

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner(msg.sender);
        _;
    }

    modifier txExists(uint256 txIndex) {
        if (txIndex >= transactions.length) revert TxNotFound(txIndex);
        _;
    }

    modifier notExecuted(uint256 txIndex) {
        if (transactions[txIndex].executed) revert TxAlreadyExecuted(txIndex);
        _;
    }

    modifier notConfirmed(uint256 txIndex) {
        if (confirmations[txIndex][msg.sender]) revert TxAlreadyConfirmed(txIndex, msg.sender);
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0 && _required > 0 && _required <= _owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
            owners.push(_owners[i]);
        }
        requiredConfirmations = _required;
    }

    function submitTransaction(address destination, uint256 value, bytes calldata data)
        external onlyOwner returns (uint256)
    {
        transactions.push(Transaction({
            destination: destination,
            value: value,
            data: data,
            executed: false,
            confirmationCount: 0
        }));

        uint256 txIndex = transactions.length - 1;
        emit TransactionSubmitted(txIndex, msg.sender);
        return txIndex;
    }

    function confirmTransaction(uint256 txIndex)
        external
        onlyOwner
        txExists(txIndex)
        notExecuted(txIndex)
        notConfirmed(txIndex)
        nonReentrant
    {
        // Prevent confirmation during active execution
        if (_executing) revert ExecutionLocked();

        confirmations[txIndex][msg.sender] = true;
        transactions[txIndex].confirmationCount++;

        emit TransactionConfirmed(txIndex, msg.sender);

        // Auto-execute if threshold met (AFTER state update)
        if (transactions[txIndex].confirmationCount >= requiredConfirmations) {
            _executeTransaction(txIndex);
        }
    }

    function _executeTransaction(uint256 txIndex) internal {
        Transaction storage txn = transactions[txIndex];

        // Double-check: not already executed
        if (txn.executed) return;

        // Lock execution to prevent re-entrant confirmations
        _executing = true;

        // Mark executed BEFORE external call (checks-effects-interactions)
        txn.executed = true;

        (bool success,) = txn.destination.call{value: txn.value}(txn.data);

        // Unlock
        _executing = false;

        if (success) {
            emit TransactionExecuted(txIndex);
        } else {
            // Revert execution state on failure
            txn.executed = false;
            emit ExecutionFailed(txIndex);
        }
    }

    function revokeConfirmation(uint256 txIndex)
        external
        onlyOwner
        txExists(txIndex)
        notExecuted(txIndex)
        nonReentrant
    {
        if (!confirmations[txIndex][msg.sender]) revert TxNotConfirmed(txIndex, msg.sender);
        if (_executing) revert ExecutionLocked();

        confirmations[txIndex][msg.sender] = false;
        transactions[txIndex].confirmationCount--;

        emit ConfirmationRevoked(txIndex, msg.sender);
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getConfirmationCount(uint256 txIndex) external view returns (uint256) {
        return transactions[txIndex].confirmationCount;
    }
}
