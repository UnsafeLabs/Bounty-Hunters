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
    // Timestamp when each confirmation was made, per txId per owner
    mapping(uint256 => mapping(address => uint256)) public confirmationTimestamp;
    // Timestamp when each revocation was made, per txId per owner
    mapping(uint256 => mapping(address => uint256)) public revocationTimestamp;
    mapping(address => bool) public isOwner;

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

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address");
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
        confirmationTimestamp[txId][msg.sender] = block.timestamp;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        revocationTimestamp[txId][msg.sender] = block.timestamp;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    /// @notice Returns the number of confirmations that were active at a given timestamp.
    ///         A confirmation is active if it was made at or before the given timestamp
    ///         AND either was never revoked, or was revoked after the given timestamp.
    function getConfirmationCountAt(uint256 txId, uint256 asOfTimestamp) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            uint256 ts = confirmationTimestamp[txId][owners[i]];
            if (ts > 0 && ts <= asOfTimestamp) {
                uint256 revokedAt = revocationTimestamp[txId][owners[i]];
                // Active if never revoked, or revoked after the snapshot time
                if (revokedAt == 0 || revokedAt > asOfTimestamp) {
                    count++;
                }
            }
        }
    }

    /// @notice Execute a confirmed transaction with reentrancy protection.
    ///         The nonReentrant guard prevents confirmations from being revoked
    ///         during a callback in the external call.
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        // Mark as executed BEFORE the external call (checks-effects-interactions)
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
