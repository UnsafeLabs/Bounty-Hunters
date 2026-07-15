// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(uint256 => mapping(address => uint256)) public confirmedAtBlock;
    mapping(uint256 => bool) public executed;
    bool private locked;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    Transaction[] public transactions;

    event Deposit(address indexed sender, uint256 value);
    event Submission(uint256 indexed transactionId);
    event Confirmation(address indexed owner, uint256 indexed transactionId);
    event Revocation(address indexed owner, uint256 indexed transactionId);
    event Execution(uint256 indexed transactionId);
    event ExecutionFailure(uint256 indexed transactionId);

    modifier ownerExists(address owner) {
        bool exists = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                exists = true;
                break;
            }
        }
        require(exists, "Owner does not exist");
        _;
    }

    modifier transactionExists(uint256 transactionId) {
        require(transactionId < transactions.length, "Transaction does not exist");
        _;
    }

    modifier notExecuted(uint256 transactionId) {
        require(!transactions[transactionId].executed, "Transaction already executed");
        _;
    }

    modifier notNullAddress(address _address) {
        require(_address != address(0), "Zero address not allowed");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "Owners required");
        require(_required > 0, "Required confirmations must be > 0");
        require(_required <= _owners.length, "Required > owners");
        owners = _owners;
        required = _required;
    }

    receive() external payable {
        if (msg.value > 0) {
            emit Deposit(msg.sender, msg.value);
        }
    }

    function submitTransaction(address to, uint256 value, bytes memory data)
        public
        notNullAddress(to)
        returns (uint256 transactionId)
    {
        require(to.code.length > 0 || data.length == 0, "Contract targets require call data");
        transactionId = transactions.length;
        transactions.push(Transaction({
            to: to,
            value: value,
            data: data,
            executed: false
        }));
        emit Submission(transactionId);
    }

    function confirmTransaction(uint256 transactionId)
        public
        ownerExists(msg.sender)
        transactionExists(transactionId)
        notExecuted(transactionId)
    {
        require(!confirmations[transactionId][msg.sender], "Already confirmed");
        confirmations[transactionId][msg.sender] = true;
        confirmedAtBlock[transactionId][msg.sender] = block.number;
        emit Confirmation(msg.sender, transactionId);
        executeTransaction(transactionId);
    }

    function revokeConfirmation(uint256 transactionId)
        public
        ownerExists(msg.sender)
        transactionExists(transactionId)
        notExecuted(transactionId)
    {
        require(confirmations[transactionId][msg.sender], "Not confirmed");
        confirmations[transactionId][msg.sender] = false;
        delete confirmedAtBlock[transactionId][msg.sender];
        emit Revocation(msg.sender, transactionId);
    }

    function isConfirmedAtBlock(uint256 transactionId, uint256 blockNumber)
        public
        view
        returns (bool)
    {
        if (transactions[transactionId].executed) return false;
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmedAtBlock[transactionId][owners[i]] > 0 &&
                confirmedAtBlock[transactionId][owners[i]] <= blockNumber) {
                count++;
            }
        }
        return count >= required;
    }

    function executeTransaction(uint256 transactionId)
        public
        ownerExists(msg.sender)
        transactionExists(transactionId)
        notExecuted(transactionId)
        nonReentrant
    {
        require(isConfirmedAtBlock(transactionId, block.number), "Not enough confirmations");

        Transaction storage txn = transactions[transactionId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        if (success) {
            executed[transactionId] = true;
            emit Execution(transactionId);
        } else {
            txn.executed = false;
            emit ExecutionFailure(transactionId);
        }
    }

    function getConfirmationCount(uint256 transactionId)
        public
        view
        returns (uint256 count)
    {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[transactionId][owners[i]]) {
                count++;
            }
        }
    }

    function getTransactionCount() public view returns (uint256) {
        return transactions.length;
    }
}
