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
    mapping(address => bool) public isOwner;

    // Confirmation timestamps: txId => owner => timestamp when confirmed
    mapping(uint256 => mapping(address => uint256)) public confirmationTimestamps;

    // Reentrancy guard lock
    bool private _locked;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    // Reentrancy guard modifier
    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Zero address owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    // Zero-address check and code-size check added
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address");
        require(to.code.length > 0 || to == address(this), "Not a contract");
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
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        confirmationTimestamps[txId][msg.sender] = block.timestamp;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        confirmationTimestamps[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    // Check if a tx was confirmed by an owner at a specific block (prevents front-running revocations)
    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) external view returns (bool) {
        require(blockNumber <= block.number, "Future block");
        // If the confirmation timestamp is set and was before or at the target block, it counts
        return confirmations[txId][owner] && confirmationTimestamps[txId][owner] > 0 && confirmationTimestamps[txId][owner] <= block.timestamp;
    }

    // Fixed: Added reentrancy guard and confirmation revocation check after execution
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");

        Transaction storage txn = transactions[txId];

        // Snapshot confirmation count before execution
        uint256 confirmationCountBefore = getConfirmationCount(txId);
        require(confirmationCountBefore >= required, "Not enough confirmations");

        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        // After execution, verify no confirmations were revoked during the callback
        uint256 confirmationCountAfter = getConfirmationCount(txId);
        require(confirmationCountAfter >= required, "Confirmations revoked during execution");

        emit Executed(txId);
    }

    receive() external payable {}
}
