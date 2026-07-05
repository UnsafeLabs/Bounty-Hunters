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

    struct ConfirmationCheckpoint {
        uint256 blockNumber;
        bool confirmed;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(uint256 => mapping(address => uint256)) public confirmationBlock;
    mapping(uint256 => mapping(address => uint256)) public confirmationTimestamp;
    mapping(uint256 => mapping(address => uint256)) public revocationBlock;
    mapping(uint256 => mapping(address => uint256)) public revocationTimestamp;
    mapping(uint256 => uint256) public confirmationCounts;
    mapping(uint256 => uint256) public revocationNonce;
    mapping(address => bool) public isOwner;

    mapping(uint256 => mapping(address => ConfirmationCheckpoint[])) private confirmationHistory;

    bool private executionEntered;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactionCount, "Unknown transaction");
        _;
    }

    modifier nonReentrantExecution() {
        require(!executionEntered, "Execution reentrancy");
        executionEntered = true;
        _;
        executionEntered = false;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Duplicate owner");
            isOwner[owner] = true;
        }

        owners = _owners;
        required = _required;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Invalid target");
        if (data.length > 0) {
            require(to.code.length > 0, "Target has no code");
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

    function confirmTransaction(uint256 txId) external onlyOwner txExists(txId) {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");

        confirmations[txId][msg.sender] = true;
        confirmationBlock[txId][msg.sender] = block.number;
        confirmationTimestamp[txId][msg.sender] = block.timestamp;
        revocationBlock[txId][msg.sender] = 0;
        revocationTimestamp[txId][msg.sender] = 0;
        confirmationCounts[txId] += 1;
        confirmationHistory[txId][msg.sender].push(ConfirmationCheckpoint(block.number, true));

        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");

        confirmations[txId][msg.sender] = false;
        revocationBlock[txId][msg.sender] = block.number;
        revocationTimestamp[txId][msg.sender] = block.timestamp;
        confirmationCounts[txId] -= 1;
        revocationNonce[txId] += 1;
        confirmationHistory[txId][msg.sender].push(ConfirmationCheckpoint(block.number, false));

        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view txExists(txId) returns (uint256) {
        return confirmationCounts[txId];
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber)
        public
        view
        txExists(txId)
        returns (bool)
    {
        if (!isOwner[owner]) {
            return false;
        }

        ConfirmationCheckpoint[] storage history = confirmationHistory[txId][owner];
        for (uint256 i = history.length; i > 0; i--) {
            ConfirmationCheckpoint storage checkpoint = history[i - 1];
            if (checkpoint.blockNumber <= blockNumber) {
                return checkpoint.confirmed;
            }
        }

        return false;
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber)
        public
        view
        txExists(txId)
        returns (uint256 count)
    {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) {
                count++;
            }
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner txExists(txId) nonReentrantExecution {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");

        uint256 executionBlock = block.number;
        uint256 confirmationCountBeforeCall = confirmationCounts[txId];
        uint256 revocationNonceBeforeCall = revocationNonce[txId];

        require(getConfirmationCountAtBlock(txId, executionBlock) >= required, "Not enough confirmations");

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");
        require(confirmationCounts[txId] == confirmationCountBeforeCall, "Confirmations changed");
        require(revocationNonce[txId] == revocationNonceBeforeCall, "Confirmation revoked");

        txn.executed = true;

        emit Executed(txId);
    }

    receive() external payable {}
}
