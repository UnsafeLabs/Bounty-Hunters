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
    struct Confirmation {
        bool active;
        uint256 confirmedAtBlock;
        uint256 confirmedAt;
        uint256 revokedAtBlock;
        uint256 revokedAt;
    }

    mapping(uint256 => mapping(address => Confirmation)) private confirmationRecords;
    mapping(uint256 => uint256) public confirmationCounts;
    mapping(address => bool) public isOwner;
    bool private executionLocked;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactionCount, "Unknown transaction");
        _;
    }

    modifier nonReentrantExecution() {
        require(!executionLocked, "Execution in progress");
        executionLocked = true;
        _;
        executionLocked = false;
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
        require(to != address(0), "Invalid target");
        require(data.length == 0 || to.code.length > 0, "Target is not contract");

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

    function confirmations(uint256 txId, address owner) external view returns (bool) {
        return confirmationRecords[txId][owner].active;
    }

    function confirmationDetails(
        uint256 txId,
        address owner
    )
        external
        view
        returns (
            bool active,
            uint256 confirmedAtBlock,
            uint256 confirmedAt,
            uint256 revokedAtBlock,
            uint256 revokedAt
        )
    {
        Confirmation storage confirmation = confirmationRecords[txId][owner];
        return (
            confirmation.active,
            confirmation.confirmedAtBlock,
            confirmation.confirmedAt,
            confirmation.revokedAtBlock,
            confirmation.revokedAt
        );
    }

    function confirmTransaction(uint256 txId) external onlyOwner txExists(txId) {
        require(!executionLocked, "Execution in progress");
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmationRecords[txId][msg.sender];
        require(!confirmation.active, "Already confirmed");
        confirmation.active = true;
        confirmation.confirmedAtBlock = block.number;
        confirmation.confirmedAt = block.timestamp;
        confirmation.revokedAtBlock = 0;
        confirmation.revokedAt = 0;
        confirmationCounts[txId]++;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) {
        require(!executionLocked, "Execution in progress");
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmationRecords[txId][msg.sender];
        require(confirmation.active, "Not confirmed");
        confirmation.active = false;
        confirmation.revokedAtBlock = block.number;
        confirmation.revokedAt = block.timestamp;
        confirmationCounts[txId]--;
        emit Revoked(txId, msg.sender);
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        Confirmation storage confirmation = confirmationRecords[txId][owner];
        if (confirmation.confirmedAtBlock == 0 || confirmation.confirmedAtBlock > blockNumber) {
            return false;
        }

        return confirmation.revokedAtBlock == 0 || confirmation.revokedAtBlock > blockNumber;
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        return confirmationCounts[txId];
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner txExists(txId) nonReentrantExecution {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");
        uint256 confirmationSnapshotBlock = block.number;
        require(confirmationCounts[txId] >= required, "Not enough confirmations");
        require(getConfirmationCountAtBlock(txId, confirmationSnapshotBlock) >= required, "Confirmations revoked");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
