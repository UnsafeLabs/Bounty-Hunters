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
        uint256 confirmSnapshotBlock;
    }

    struct Confirmation {
        bool confirmed;
        uint256 timestamp;
        uint256 blockNumber;
    }

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;
    bool private _entered;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(!_entered, "Reentrancy detected");
        _entered = true;
        _;
        _entered = false;
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
        require(to != address(this), "Cannot call self");

        uint256 txId = transactionCount++;
        transactions.push(Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmSnapshotBlock: 0
        }));
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(txId < transactions.length, "Invalid txId");
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].confirmed, "Already confirmed");

        confirmations[txId][msg.sender] = Confirmation({
            confirmed: true,
            timestamp: block.timestamp,
            blockNumber: block.number
        });
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(txId < transactions.length, "Invalid txId");
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");

        confirmations[txId][msg.sender] = Confirmation({
            confirmed: false,
            timestamp: 0,
            blockNumber: 0
        });
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        require(txId < transactions.length, "Invalid txId");
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        require(txId < transactions.length, "Invalid txId");
        uint256 count;
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation storage c = confirmations[txId][owners[i]];
            if (c.confirmed && c.blockNumber <= blockNumber) count++;
        }
        return count >= required;
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(txId < transactions.length, "Invalid txId");
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;
        txn.confirmSnapshotBlock = block.number;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
