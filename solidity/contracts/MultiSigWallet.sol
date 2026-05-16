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

    struct Confirmation {
        bool confirmed;
        uint256 confirmedAtBlock;
        uint256 revokedAtBlock;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(uint256 => uint256) public lastConfirmationChangeBlock;
    mapping(address => bool) public isOwner;

    uint256 private executionLock = 1;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier nonReentrantExecution() {
        require(executionLock == 1, "Reentrant execution");
        executionLock = 2;
        _;
        executionLock = 1;
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
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmations[txId][msg.sender];
        require(!confirmation.confirmed, "Already confirmed");
        confirmation.confirmed = true;
        confirmation.confirmedAtBlock = block.number;
        confirmation.revokedAtBlock = 0;
        lastConfirmationChangeBlock[txId] = block.number;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        Confirmation storage confirmation = confirmations[txId][msg.sender];
        require(confirmation.confirmed, "Not confirmed");
        confirmation.confirmed = false;
        confirmation.revokedAtBlock = block.number;
        lastConfirmationChangeBlock[txId] = block.number;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function isConfirmedAtBlock(
        uint256 txId,
        address owner,
        uint256 blockNumber
    ) public view returns (bool) {
        Confirmation storage confirmation = confirmations[txId][owner];
        return confirmation.confirmedAtBlock != 0
            && confirmation.confirmedAtBlock <= blockNumber
            && (confirmation.revokedAtBlock == 0 || confirmation.revokedAtBlock > blockNumber);
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrantExecution {
        require(!transactions[txId].executed, "Already executed");
        uint256 confirmationBlock = block.number;
        uint256 changeBlockBeforeExecution = lastConfirmationChangeBlock[txId];
        require(getConfirmationCountAtBlock(txId, confirmationBlock) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        if (
            lastConfirmationChangeBlock[txId] == confirmationBlock
                && lastConfirmationChangeBlock[txId] != changeBlockBeforeExecution
        ) {
            require(getConfirmationCountAtBlock(txId, confirmationBlock) >= required, "Confirmations revoked");
        }

        txn.executed = true;
        emit Executed(txId);
    }

    receive() external payable {}
}
