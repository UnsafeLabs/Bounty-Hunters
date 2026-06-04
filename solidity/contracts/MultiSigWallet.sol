// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    uint256 private constant _NOT_EXECUTING = 1;
    uint256 private constant _EXECUTING = 2;

    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;
    uint256 private executionStatus = _NOT_EXECUTING;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    struct Confirmation {
        bool active;
        uint256 confirmedAt;
        uint256 confirmedBlock;
        uint256 revokedBlock;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactionCount, "Transaction does not exist");
        _;
    }

    modifier notExecuting() {
        require(executionStatus != _EXECUTING, "Execution in progress");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Zero address owner");
            require(!isOwner[owner], "Duplicate owner");
            isOwner[owner] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address target");
        require(data.length == 0 || to.code.length > 0, "Target has no code");

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

    function confirmTransaction(uint256 txId) external onlyOwner txExists(txId) notExecuting {
        require(!transactions[txId].executed, "Already executed");

        Confirmation storage confirmation = confirmations[txId][msg.sender];
        require(!confirmation.active, "Already confirmed");

        confirmation.active = true;
        confirmation.confirmedAt = block.timestamp;
        confirmation.confirmedBlock = block.number;
        confirmation.revokedBlock = 0;

        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) notExecuting {
        require(!transactions[txId].executed, "Already executed");

        Confirmation storage confirmation = confirmations[txId][msg.sender];
        require(confirmation.active, "Not confirmed");

        confirmation.active = false;
        confirmation.revokedBlock = block.number;

        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view txExists(txId) returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].active) count++;
        }
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view txExists(txId) returns (bool) {
        Confirmation memory confirmation = confirmations[txId][owner];
        return confirmation.confirmedBlock != 0
            && confirmation.confirmedBlock <= blockNumber
            && (confirmation.revokedBlock == 0 || confirmation.revokedBlock > blockNumber);
    }

    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) external view txExists(txId) returns (bool) {
        return _getConfirmationCountAtBlock(txId, blockNumber) >= required;
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) external view txExists(txId) returns (uint256) {
        return _getConfirmationCountAtBlock(txId, blockNumber);
    }

    function executeTransaction(uint256 txId) external onlyOwner txExists(txId) notExecuting {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");
        require(_getConfirmationCountAtBlock(txId, block.number) >= required, "Not enough confirmations");

        executionStatus = _EXECUTING;
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        executionStatus = _NOT_EXECUTING;
        emit Executed(txId);
    }

    function _getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) internal view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    receive() external payable {}
}
