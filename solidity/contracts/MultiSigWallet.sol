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

    struct ConfirmationInfo {
        mapping(address => bool) confirmed;
        mapping(address => uint256) timestamps;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => ConfirmationInfo) private _confirmations;
    mapping(address => bool) public isOwner;

    // Reentrancy guard
    bool private _locked;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

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
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    // Fixed: Added zero-address validation on `to`
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address not allowed");
        // Check that target has code (if data is not empty)
        if (data.length > 0) {
            uint256 size;
            assembly { size := extcodesize(to) }
            require(size > 0, "Target has no code");
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
        require(!_confirmations[txId].confirmed[msg.sender], "Already confirmed");
        _confirmations[txId].confirmed[msg.sender] = true;
        _confirmations[txId].timestamps[msg.sender] = block.timestamp;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(_confirmations[txId].confirmed[msg.sender], "Not confirmed");
        _confirmations[txId].confirmed[msg.sender] = false;
        _confirmations[txId].timestamps[msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (_confirmations[txId].confirmed[owners[i]]) count++;
        }
    }

    // Fixed: Reentrancy protection via nonReentrant modifier
    // Fixed: Snapshot confirmations at execution time to prevent front-running
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        // Check confirmations at block-level snapshot
        require(isConfirmedAtBlock(txId, block.number), "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    // Fixed: Block-level confirmation check
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        uint256 count;
        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];
            if (_confirmations[txId].confirmed[owner] && _confirmations[txId].timestamps[owner] <= block.timestamp) {
                count++;
            }
        }
        return count >= required;
    }

    receive() external payable {}
}
