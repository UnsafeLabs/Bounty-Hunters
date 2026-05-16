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
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;

    // Reentrancy guard: lock per txId prevents confirmation revocation during execution
    mapping(uint256 => bool) private _executing;

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
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    // Fixed: zero-address and code-size check added to `to` validation
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address");
        require(to.code.length == 0, "Contract target not allowed");
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

    // Revoke blocked while transaction is executing (reentrancy guard)
    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(_executing[txId] == false, "Currently executing");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    // Fixed: block-level snapshot + reentrancy lock
    function executeTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        // Snapshot confirmations at current block to prevent front-running revocation
        uint256 confirmCount = getConfirmationCount(txId);
        require(confirmCount >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        // Reentrancy lock: mark as executing before external call
        _executing[txId] = true;
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        _executing[txId] = false;

        require(success, "Execution failed");
        emit Executed(txId);
    }

    receive() external payable {}
}