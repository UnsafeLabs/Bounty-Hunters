// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;
    bool private _executing;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    mapping(uint256 => Transaction) public transactions;
    // Confirmation block number: 0 = not confirmed, >0 = block number when confirmed
    mapping(uint256 => mapping(address => uint256)) public confirmations;
    // Historical confirmation block — set on first confirm, never reset on revoke.
    // Enables isConfirmedAtBlock to work even after revocation.
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

    modifier noActiveExecution() {
        require(!_executing, "Execution in progress");
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
        require(to != address(0), "Zero address target");
        require(to.code.length > 0, "Target not a contract");
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

    function confirmTransaction(uint256 txId) external onlyOwner noActiveExecution {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender] == 0, "Already confirmed");
        confirmations[txId][msg.sender] = block.number;
        // Only record the first confirmation block — never overwrite on re-confirmation
        // This preserves historical data for isConfirmedAtBlock even after revoke+reconfirm
        if (confirmationBlock[txId][msg.sender] == 0) {
            confirmationBlock[txId][msg.sender] = block.number;
        }
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner noActiveExecution {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender] > 0, "Not confirmed");
        confirmations[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    /// @notice Check whether an owner had confirmed a transaction at or before a given block number.
    /// Uses the immutable confirmationBlock record which survives revocation.
    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        uint256 confirmedAt = confirmationBlock[txId][owner];
        return confirmedAt > 0 && confirmedAt <= blockNumber;
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]] > 0) count++;
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");
        require(!_executing, "Reentrancy");

        Transaction storage txn = transactions[txId];
        txn.executed = true;
        _executing = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);

        _executing = false;
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
