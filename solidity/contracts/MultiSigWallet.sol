```solidity
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

    // Confirmation now includes a timestamp to track when it was made
    struct Confirmation {
        bool confirmed;
        uint256 timestamp;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;
    mapping(uint256 => uint256) public confirmationCounts;

    // Reentrancy guard
    uint256 private _guard;
    modifier nonReentrant() {
        require(_guard == 0, "ReentrancyGuard: reentrant call");
        _guard = 1;
        _;
        _guard = 0;
    }

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
            require(_owners[i] != address(0), "Zero address not allowed");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyOwner returns (uint256) {
        require(to != address(0), "Invalid to address");
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
            timestamp: block.timestamp
        });
        confirmationCounts[txId]++;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");
        confirmations[txId][msg.sender] = Confirmation({
            confirmed: false,
            timestamp: 0
        });
        confirmationCounts[txId]--;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256) {
        return confirmationCounts[txId];
    }

    function isConfirmedAtBlock(
        uint256 txId,
        uint256 blockNumber
    ) public view returns (bool) {
        if (blockNumber > block.number) return false;
        uint256 count;
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation memory conf = confirmations[txId][owners[i]];
            if (conf.confirmed && conf.timestamp <= blockNumber) {
                count++;
            }
        }
        return count >= required;
    }

    function executeTransaction(
        uint256 txId
    ) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        
        // Snapshot confirmation count before execution to prevent revocation during callback
        uint256 currentConfirmationCount = confirmationCounts[txId];
        require(currentConfirmationCount >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
```