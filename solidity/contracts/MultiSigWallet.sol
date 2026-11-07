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
        uint256 confirmationBlock; // Block number when required confirmations reached
    }

    struct Confirmation {
        bool confirmed;
        uint256 blockNumber; // Block when confirmation was made
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;
    
    bool private _reentrancyGuard;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner, uint256 blockNumber);
    event Executed(uint256 indexed txId, uint256 confirmationBlock);
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

    // FIXED: Zero-address validation and code-size check for contract targets
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Invalid recipient");
        
        // If there's data, verify it's a contract
        if (data.length > 0) {
            uint256 size;
            assembly {
                size := extcodesize(to)
            }
            require(size > 0, "Target must be contract");
        }
        
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmationBlock: 0
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
        
        emit Confirmed(txId, msg.sender, block.number);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");
        confirmations[txId][msg.sender].confirmed = false;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    // Get confirmation count at a specific block to detect revocations
    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation storage conf = confirmations[txId][owners[i]];
            if (conf.confirmed && conf.blockNumber <= blockNumber) {
                count++;
            }
        }
    }

    // FIXED: Reentrancy protection and block-level confirmation snapshot
    function executeTransaction(uint256 txId) external onlyOwner {
        require(!_reentrancyGuard, "Reentrant call");
        require(!transactions[txId].executed, "Already executed");
        
        // Snapshot confirmation count at current block
        uint256 confirmationBlock = block.number;
        require(getConfirmationCountAtBlock(txId, confirmationBlock) >= required, "Not enough confirmations");
        
        Transaction storage txn = transactions[txId];
        txn.executed = true;
        txn.confirmationBlock = confirmationBlock;
        
        // Set reentrancy guard
        _reentrancyGuard = true;
        
        // Execute external call
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        
        // Reset reentrancy guard
        _reentrancyGuard = false;
        
        require(success, "Execution failed");
        
        // Verify confirmations were not revoked during execution
        require(getConfirmationCountAtBlock(txId, confirmationBlock) >= required, "Confirmations revoked");
        
        emit Executed(txId, confirmationBlock);
    }

    // Check if transaction was confirmed at a specific block
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) external view returns (bool) {
        return getConfirmationCountAtBlock(txId, blockNumber) >= required;
    }

    receive() external payable {}
}
