// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmationCount; // snapshot of confirmations at execution time
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;

    // Reentrancy guard
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _status;

    error NotOwner();
    error ZeroAddress();
    error InvalidRequired();
    error NoOwners();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error ExecutionFailed();
    error ReentrantCall();

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) {
            revert NotOwner();
        }
        _;
    }

    modifier nonReentrant() {
        if (_status == ENTERED) {
            revert ReentrantCall();
        }
        _status = ENTERED;
        _;
        _status = NOT_ENTERED;
    }

    constructor(address[] memory _owners, uint256 _required) {
        if (_owners.length == 0) {
            revert NoOwners();
        }
        if (_required == 0 || _required > _owners.length) {
            revert InvalidRequired();
        }
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
        _status = NOT_ENTERED;
    }

    // Fix: Add zero-address validation
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmationCount: 0
        });
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        if (transactions[txId].executed) {
            revert AlreadyExecuted();
        }
        if (confirmations[txId][msg.sender]) {
            revert AlreadyConfirmed();
        }
        confirmations[txId][msg.sender] = true;
        transactions[txId].confirmationCount++;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        if (transactions[txId].executed) {
            revert AlreadyExecuted();
        }
        if (!confirmations[txId][msg.sender]) {
            revert NotConfirmed();
        }
        confirmations[txId][msg.sender] = false;
        transactions[txId].confirmationCount--;
        emit Revoked(txId, msg.sender);
    }

    // Fix: Use stored confirmation count instead of iterating owners
    // Fix: Snapshot confirmation count before execution
    // Fix: Add nonReentrant modifier to prevent race condition during callback
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        Transaction storage txn = transactions[txId];
        if (txn.executed) {
            revert AlreadyExecuted();
        }

        // Snapshot the confirmation count before execution
        // This prevents race conditions where confirmations change during callback
        uint256 confirmCount = txn.confirmationCount;
        if (confirmCount < required) {
            revert NotEnoughConfirmations();
        }

        // Mark as executed BEFORE external call (CEI pattern)
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        if (!success) {
            // Revert execution status on failure
            txn.executed = false;
            revert ExecutionFailed();
        }

        emit Executed(txId);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256) {
        return transactions[txId].confirmationCount;
    }

    receive() external payable {}
}
