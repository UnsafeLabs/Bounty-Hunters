// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MultiSigWallet is ReentrancyGuard {
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
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(uint256 => mapping(address => Confirmation)) public confirmationDetails;
    mapping(address => bool) public isOwner;

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

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(txId < transactionCount, "Transaction does not exist");
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");

        confirmations[txId][msg.sender] = true;
        confirmationDetails[txId][msg.sender] = Confirmation({
            confirmed: true,
            confirmedAtBlock: block.number,
            revokedAtBlock: 0
        });
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(txId < transactionCount, "Transaction does not exist");
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");

        confirmations[txId][msg.sender] = false;
        Confirmation storage confirmation = confirmationDetails[txId][msg.sender];
        confirmation.confirmed = false;
        confirmation.revokedAtBlock = block.number;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        Confirmation memory confirmation = confirmationDetails[txId][owner];
        return confirmation.confirmedAtBlock != 0
            && confirmation.confirmedAtBlock <= blockNumber
            && (confirmation.revokedAtBlock == 0 || confirmation.revokedAtBlock > blockNumber);
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(txId < transactionCount, "Transaction does not exist");
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");

        uint256 executionBlock = block.number;
        require(getConfirmationCountAtBlock(txId, executionBlock) >= required, "Not enough confirmations");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");
        require(getConfirmationCountAtBlock(txId, executionBlock) >= required, "Confirmations changed");

        emit Executed(txId);
    }

    receive() external payable {}
}
