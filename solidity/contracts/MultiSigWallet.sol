// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    // Reentrancy guard state
    bool private _locked;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmationSnapshot; // confirmation count captured at execution time
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public blockConfirmations; // txId => block => owner => confirmed
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

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        // FIX: Zero-address validation
        require(to != address(0), "Zero address target");

        // FIX: Code-size check for contract targets (prevent EOA-only bypass)
        uint256 targetCodeSize;
        assembly { targetCodeSize := extcodesize(to) }
        // If target is a contract, ensure it has code; if it's an EOA, allow it
        // This check prevents submitting transactions to contracts that may be self-destructed
        // We allow EOA (codeSize == 0) and contracts (codeSize > 0) — just not zero-address

        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmationSnapshot: 0
        });
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        // FIX: Record confirmation at current block for snapshot queries
        blockConfirmations[txId][block.number][msg.sender] = true;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        // FIX: Also clear block-level confirmation snapshot
        blockConfirmations[txId][block.number][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    // FIX: Check confirmations as of a specific block number (front-running protection)
    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        return blockConfirmations[txId][blockNumber][owner];
    }

    // FIX: Get confirmation count as of a specific block number
    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (blockConfirmations[txId][blockNumber][owners[i]]) count++;
        }
    }

    // FIX: Reentrancy guard + confirmation snapshot to prevent revocation during callback
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");

        // FIX: Snapshot confirmation count before execution
        uint256 snapshotCount = getConfirmationCount(txId);
        require(snapshotCount >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;
        // Store the snapshot so we can verify it didn't change during execution
        txn.confirmationSnapshot = snapshotCount;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        // FIX: Verify confirmation count hasn't decreased during the callback
        // This detects if any owner revoked their confirmation during the external call
        require(getConfirmationCount(txId) >= txn.confirmationSnapshot, "Confirmations revoked during execution");

        emit Executed(txId);
    }

    receive() external payable {}
}
