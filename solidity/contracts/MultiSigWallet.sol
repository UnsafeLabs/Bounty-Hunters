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
        bool isConfirmed;
        uint256 timestamp;
        uint256 blockNumber;
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
        require(to != address(0), "Zero address");
        if (data.length > 0) {
            require(to.code.length > 0, "Target must be a contract if data is provided");
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
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].isConfirmed, "Already confirmed");
        
        confirmations[txId][msg.sender] = Confirmation({
            isConfirmed: true,
            timestamp: block.timestamp,
            blockNumber: block.number
        });
        
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].isConfirmed, "Not confirmed");
        
        delete confirmations[txId][msg.sender];
        
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].isConfirmed) count++;
        }
    }

    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation memory conf = confirmations[txId][owners[i]];
            if (conf.isConfirmed && conf.blockNumber <= blockNumber) {
                count++;
            }
        }
        return count >= required;
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        
        // Block-level confirmation check to prevent front-running revocations
        require(isConfirmedAtBlock(txId, block.number), "Not enough confirmations at current block");
        
        // Also check getConfirmationCount directly to ensure no revocation happened in same block before this tx
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        // Verify count hasn't dropped after external call (defense in depth, though nonReentrant covers the call)
        require(getConfirmationCount(txId) >= required, "Confirmations dropped during execution");

        emit Executed(txId);
    }

    receive() external payable {}
}
