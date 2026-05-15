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
        bool confirmed;
        uint256 confirmedAtBlock;
        uint256 revokedAtBlock;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) private confirmationRecords;
    mapping(uint256 => uint256) private confirmationCounts;
    mapping(uint256 => uint256) private lastRevocationBlocks;
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier nonReentrantExecution() {
        require(executionStatus != _EXECUTING, "Reentrant execution");
        executionStatus = _EXECUTING;
        _;
        executionStatus = _NOT_EXECUTING;
    }

    modifier transactionExists(uint256 txId) {
        require(txId < transactionCount, "Transaction does not exist");
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

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Invalid target");
        if (data.length > 0) {
            require(to.code.length > 0, "Target not contract");
        }

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

    function confirmTransaction(uint256 txId) external onlyOwner transactionExists(txId) {
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmationRecords[txId][msg.sender];
        require(!confirmation.confirmed, "Already confirmed");
        confirmation.confirmed = true;
        confirmation.confirmedAtBlock = block.number;
        confirmationCounts[txId]++;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner transactionExists(txId) {
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmationRecords[txId][msg.sender];
        require(confirmation.confirmed, "Not confirmed");
        confirmation.confirmed = false;
        confirmation.revokedAtBlock = block.number;
        lastRevocationBlocks[txId] = block.number;
        confirmationCounts[txId]--;
        emit Revoked(txId, msg.sender);
    }

    function confirmations(uint256 txId, address owner) external view returns (bool) {
        return confirmationRecords[txId][owner].confirmed;
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        Confirmation memory confirmation = confirmationRecords[txId][owner];
        if (confirmation.confirmedAtBlock == 0 || confirmation.confirmedAtBlock > blockNumber) {
            return false;
        }

        if (confirmation.revokedAtBlock == 0 || confirmation.confirmedAtBlock > confirmation.revokedAtBlock) {
            return true;
        }

        if (confirmation.confirmed && confirmation.confirmedAtBlock == confirmation.revokedAtBlock) {
            return blockNumber > confirmation.revokedAtBlock;
        }

        return confirmation.revokedAtBlock > blockNumber;
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        return confirmationCounts[txId];
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner transactionExists(txId) nonReentrantExecution {
        require(!transactions[txId].executed, "Already executed");
        require(confirmationCounts[txId] >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        uint256 executionBlock = block.number;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");
        require(confirmationCounts[txId] >= required, "Confirmations revoked");
        require(lastRevocationBlocks[txId] < executionBlock, "Confirmations revoked");

        txn.executed = true;
        emit Executed(txId);
    }

    receive() external payable {}
}
