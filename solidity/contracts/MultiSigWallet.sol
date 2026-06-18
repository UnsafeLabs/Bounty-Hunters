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
    mapping(uint256 => mapping(address => uint256)) public confirmationTimestamp;
    mapping(uint256 => mapping(address => uint256)) public confirmationBlock;
    mapping(uint256 => mapping(address => uint256)) public revocationBlock;
    mapping(address => bool) public isOwner;

    bool private executing;

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
            require(_owners[i] != address(0), "Invalid owner");
            require(!isOwner[_owners[i]], "Duplicate owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Invalid target");
        require(data.length == 0 || to.code.length > 0, "Target not contract");

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
        require(!executing, "Execution in progress");
        require(txId < transactionCount, "Transaction does not exist");
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        confirmationTimestamp[txId][msg.sender] = block.timestamp;
        confirmationBlock[txId][msg.sender] = block.number;
        revocationBlock[txId][msg.sender] = 0;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!executing, "Execution in progress");
        require(txId < transactionCount, "Transaction does not exist");
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        revocationBlock[txId][msg.sender] = block.number;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        uint256 confirmedAt = confirmationBlock[txId][owner];
        if (confirmedAt == 0 || confirmedAt > blockNumber) {
            return false;
        }

        uint256 revokedAt = revocationBlock[txId][owner];
        if (revokedAt == 0 || revokedAt > blockNumber) {
            return true;
        }

        return false;
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner {
        require(!executing, "Execution in progress");
        require(txId < transactionCount, "Transaction does not exist");
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCountAtBlock(txId, block.number) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        executing = true;
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");
        require(getConfirmationCount(txId) >= required, "Confirmations revoked");

        executing = false;
        emit Executed(txId);
    }

    receive() external payable {}
}
