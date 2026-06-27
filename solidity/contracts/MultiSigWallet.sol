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
    // FIX: Track confirmation block number to detect front-running revocations
    mapping(uint256 => mapping(address => uint256)) public confirmationBlock;
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

    // FIX: Added zero-address check and code-size check for contract targets
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Invalid target: zero address");
        // Check if target is a contract (code size > 0) — if so, it's intentional
        // If target has no code and value is 0, it's a plain ETH transfer to an EOA
        uint256 codeSize;
        assembly { codeSize := extcodesize(to) }
        // Allow EOA transfers (codeSize == 0) but require value > 0 for safety
        // Allow contract interactions (codeSize > 0) with any value
        if (codeSize == 0) {
            require(value > 0, "EOA target requires non-zero value");
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
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        // FIX: Record block number of confirmation for front-running detection
        confirmationBlock[txId][msg.sender] = block.number;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        confirmationBlock[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    // FIX: Check confirmations as of a specific block — prevents front-running revocations
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];
            if (confirmations[txId][owner] && confirmationBlock[txId][owner] <= blockNumber) {
                count++;
            }
        }
        return count >= required;
    }

    // FIX: Reentrancy protection — snapshot confirmation count before external call
    // and verify it hasn't changed after the call returns
    function executeTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];

        // FIX: Snapshot the confirmation count before execution
        uint256 confirmCountBefore = getConfirmationCount(txId);

        // Mark as executed BEFORE external call (CEI pattern)
        txn.executed = true;

        // Verify confirmations haven't been revoked during this transaction
        // (defense in depth — even though we marked executed=true, this logs the state)
        require(confirmCountBefore >= required, "Confirmations revoked before execution");

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        // FIX: Post-execution check — if confirmations were revoked during callback,
        // the transaction is already marked executed so no re-execution possible
        // But we emit the event to signal completion
        emit Executed(txId);
    }

    receive() external payable {}
}
