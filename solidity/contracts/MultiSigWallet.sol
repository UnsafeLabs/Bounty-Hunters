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
    // Stores the block number at which an owner confirmed a txId.
    // 0 = not confirmed; > 0 = confirmed at that block. Revoking resets to 0.
    // Block number (not timestamp) is used so confirmations can be evaluated
    // against a specific block via isConfirmedAtBlock.
    mapping(uint256 => mapping(address => uint256)) public confirmations;
    mapping(address => bool) public isOwner;

    // Reentrancy guard using the 1/2 pattern (cheaper SSTOREs than 0/1).
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status == _NOT_ENTERED, "Reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
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
        require(to != address(0), "Invalid recipient");
        // A contract call (non-empty data) must target a contract.
        if (data.length > 0) {
            require(to.code.length > 0, "Must be contract");
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
        require(confirmations[txId][msg.sender] == 0, "Already confirmed");
        confirmations[txId][msg.sender] = block.number;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender] != 0, "Not confirmed");
        confirmations[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]] != 0) count++;
        }
    }

    // Returns true if the number of confirmations recorded at or before
    // `blockNumber` (and not since revoked) meets the required threshold.
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        uint256 count;
        for (uint256 i = 0; i < owners.length; i++) {
            uint256 confirmedAt = confirmations[txId][owners[i]];
            if (confirmedAt != 0 && confirmedAt <= blockNumber) count++;
        }
        return count >= required;
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");

        // Snapshot the block and verify confirmations are valid as of it.
        // Combined with nonReentrant, this prevents a callback from revoking
        // confirmations mid-execution and prevents same-block front-running.
        uint256 snapshotBlock = block.number;
        require(isConfirmedAtBlock(txId, snapshotBlock), "Not enough confirmations");

        // Effects before interaction (CEI): mark executed before the call.
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
