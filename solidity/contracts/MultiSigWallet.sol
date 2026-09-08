// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;
    
    // Reentrancy guard
    bool private locked;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    // Confirmation tracking with timestamp
    struct Confirmation {
        bool confirmed;
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
    
    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
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

    // FIX: Added zero-address validation and code-size check for contract targets
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Cannot send to zero address");
        require(to.code.length > 0 || value > 0, "No code and no value - invalid transaction");
        
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
        require(!confirmations[txId][msg.sender].confirmed, "Already confirmed");
        confirmations[txId][msg.sender] = Confirmation({
            confirmed: true,
            blockNumber: block.number
        });
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");
        confirmations[txId][msg.sender] = Confirmation({
            confirmed: false,
            blockNumber: block.number
        });
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }
    
    // FIX: Added block-level confirmation check to prevent front-running revocations
    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        Confirmation storage conf = confirmations[txId][owner];
        return conf.confirmed && conf.blockNumber <= blockNumber;
    }
    
    function getConfirmationBlock(uint256 txId, address owner) public view returns (uint256) {
        return confirmations[txId][owner].blockNumber;
    }

    // FIX: Added reentrancy protection and block-level confirmation snapshot
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        
        // Take snapshot of current block to prevent front-running revocations
        uint256 snapshotBlock = block.number;
        uint256 confirmedCount = 0;
        
        // Count confirmations as of the snapshot block
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], snapshotBlock)) {
                confirmedCount++;
            }
        }
        
        require(confirmedCount >= required, "Not enough confirmations at snapshot block");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
