// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;
    bool private executionActive;
    uint256 private activeExecutionTxId;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    struct Confirmation {
        bool confirmed;
        uint64 confirmedAtBlock;
        uint64 revokedAtBlock;
        uint64 confirmedAt;
        uint64 revokedAt;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;
    mapping(uint256 => bool) private revokedDuringExecution;

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

    modifier nonReentrant() {
        require(!executionActive, "Reentrant execution");
        executionActive = true;
        _;
        executionActive = false;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Duplicate owner");
            isOwner[owner] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        _validateTarget(to, data);

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

    function confirmTransaction(uint256 txId) external onlyOwner txExists(txId) {
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmations[txId][msg.sender];
        require(!confirmation.confirmed, "Already confirmed");
        confirmation.confirmed = true;
        confirmation.confirmedAtBlock = uint64(block.number);
        confirmation.confirmedAt = uint64(block.timestamp);
        confirmation.revokedAtBlock = 0;
        confirmation.revokedAt = 0;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) {
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmations[txId][msg.sender];
        require(confirmation.confirmed, "Not confirmed");
        confirmation.confirmed = false;
        confirmation.revokedAtBlock = uint64(block.number);
        confirmation.revokedAt = uint64(block.timestamp);
        if (executionActive && activeExecutionTxId == txId) {
            revokedDuringExecution[txId] = true;
        }
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view txExists(txId) returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view txExists(txId) returns (bool) {
        return _isConfirmedAtBlock(txId, owner, blockNumber);
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view txExists(txId) returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (_isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner txExists(txId) nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        uint256 confirmationBlock = block.number;
        require(getConfirmationCountAtBlock(txId, confirmationBlock) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        revokedDuringExecution[txId] = false;
        activeExecutionTxId = txId;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");
        require(!revokedDuringExecution[txId], "Confirmation revoked during execution");

        txn.executed = true;
        activeExecutionTxId = 0;
        emit Executed(txId);
    }

    function _isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) private view returns (bool) {
        Confirmation storage confirmation = confirmations[txId][owner];
        return (
            confirmation.confirmedAtBlock != 0 &&
            confirmation.confirmedAtBlock <= blockNumber &&
            (confirmation.revokedAtBlock == 0 || confirmation.revokedAtBlock > blockNumber)
        );
    }

    function _validateTarget(address to, bytes calldata data) private view {
        require(to != address(0), "Invalid target");
        if (data.length > 0) {
            require(to.code.length > 0, "Target is not a contract");
        }
    }

    receive() external payable {}
}
