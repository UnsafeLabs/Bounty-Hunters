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
    mapping(uint256 => mapping(address => uint256)) public confirmationTs;
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    bool private locked;

    modifier noReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

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
        require(to.code.length > 0 || value > 0, "Invalid target");
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
        confirmationTs[txId][msg.sender] = block.timestamp;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        confirmationTs[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    function isConfirmed(uint256 txId) public view returns (bool) {
        return getConfirmationCount(txId) >= required;
    }

    function isConfirmedAtBlock(uint256 txId) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]] && confirmationTs[txId][owners[i]] > 0) {
                count++;
            }
        }
        return count >= required;
    }

    function executeTransaction(uint256 txId) external onlyOwner noReentrant {
        require(!transactions[txId].executed, "Already executed");

        // Snapshot confirmation count at the start
        uint256 snapshotCount = getConfirmationCount(txId);
        require(snapshotCount >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        // Verify confirmations still hold after marking executed
        require(isConfirmedAtBlock(txId), "Confirmations changed during execution");

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
