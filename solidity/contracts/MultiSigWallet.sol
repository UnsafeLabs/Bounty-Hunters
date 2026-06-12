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
        uint256 confirmedBlock; // Block when it reached 'required' confirmations
    }

    struct Confirmation {
        bool confirmed;
        uint256 blockNumber;
    }

    mapping(uint256 => Transaction) public transactions;
    // txId => owner => confirmation data
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
        require(to != address(0), "Invalid to address");
        
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmedBlock: 0
        });
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].confirmed, "Already confirmed");
        
        confirmations[txId][msg.sender] = Confirmation({
            confirmed: true,
            blockNumber: block.number
        });
        
        if (getConfirmationCount(txId) >= required && transactions[txId].confirmedBlock == 0) {
            transactions[txId].confirmedBlock = block.number;
        }
        
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");
        
        confirmations[txId][msg.sender].confirmed = false;
        
        if (getConfirmationCount(txId) < required) {
            transactions[txId].confirmedBlock = 0;
        }
        
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    /**
     * @dev Checks if a transaction has at least 'required' confirmations as of 'targetBlock'.
     * Prevents front-running revocations during execution.
     */
    function isConfirmedAtBlock(uint256 txId, uint256 targetBlock) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation storage conf = confirmations[txId][owners[i]];
            if (conf.confirmed && conf.blockNumber <= targetBlock) {
                count++;
            }
        }
        return count >= required;
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");
        
        // Ensure confirmations are valid as of the block execution was initiated
        // This prevents revocations in the same block (front-running) or during callback
        require(isConfirmedAtBlock(txId, block.number), "Not enough confirmations");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
