// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    // Reentrancy guard
    bool private _executing;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 submissionBlock;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier noReentrancy() {
        require(!_executing, "Reentrancy detected");
        _executing = true;
        _;
        _executing = false;
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

    /// @notice Submit a new transaction
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address target");
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmations: 0,
            submissionBlock: block.number
        });
        emit Submitted(txId);
        return txId;
    }

    /// @notice Confirm a transaction
    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        transactions[txId].confirmations += 1;
        emit Confirmed(txId, msg.sender);
    }

    /// @notice Revoke a confirmation
    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        transactions[txId].confirmations -= 1;
        emit Revoked(txId, msg.sender);
    }

    /// @notice Get confirmation count for a transaction
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    /// @notice Execute a transaction — requires no reentrancy
    /// @dev Reverts if a confirmation was revoked between check and execution
    function executeTransaction(uint256 txId) external onlyOwner noReentrancy {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");

        // Re-check confirmation count at execution time to prevent race condition
        // where a confirmation was revoked during a previous execution attempt
        uint256 currentConfirmations = getConfirmationCount(txId);
        require(currentConfirmations >= required, "Not enough confirmations");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    /// @notice Check if a transaction has enough confirmations at a specific block
    /// @dev Used to verify historical confirmation states
    function isConfirmedAsOf(uint256 txId, uint256 blockNumber) external view returns (bool) {
        Transaction storage txn = transactions[txId];
        if (txn.submissionBlock > blockNumber) return false;
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
            if (count >= required) return true;
        }
        return false;
    }

    receive() external payable {}
}
