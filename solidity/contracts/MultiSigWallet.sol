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

    struct Confirmation {
        bool confirmed;
        uint256 confirmedAtBlock;
        uint256 revokedAtBlock;
    }

    struct ConfirmationCheckpoint {
        uint256 blockNumber;
        bool confirmed;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmationRecords;
    mapping(uint256 => mapping(address => ConfirmationCheckpoint[])) private confirmationHistory;
    mapping(uint256 => uint256) private confirmationCounts;
    mapping(address => bool) public isOwner;

    bool private executingTransaction;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier transactionExists(uint256 txId) {
        require(txId < transactionCount, "Transaction does not exist");
        _;
    }

    modifier nonReentrantExecution() {
        require(!executingTransaction, "Reentrant execution");
        executingTransaction = true;
        _;
        executingTransaction = false;
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

    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyOwner returns (uint256) {
        require(to != address(0), "Invalid target");
        if (data.length > 0) {
            require(to.code.length > 0, "Target must be contract");
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

    function confirmTransaction(uint256 txId) external onlyOwner transactionExists(txId) {
        require(!transactions[txId].executed, "Already executed");

        Confirmation storage confirmation = confirmationRecords[txId][msg.sender];
        require(!confirmation.confirmed, "Already confirmed");

        confirmation.confirmed = true;
        confirmation.confirmedAtBlock = block.number;
        confirmation.revokedAtBlock = 0;
        confirmationHistory[txId][msg.sender].push(
            ConfirmationCheckpoint({blockNumber: block.number, confirmed: true})
        );
        confirmationCounts[txId] += 1;

        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner transactionExists(txId) {
        require(!transactions[txId].executed, "Already executed");

        Confirmation storage confirmation = confirmationRecords[txId][msg.sender];
        require(confirmation.confirmed, "Not confirmed");

        confirmation.confirmed = false;
        confirmation.revokedAtBlock = block.number;
        confirmationHistory[txId][msg.sender].push(
            ConfirmationCheckpoint({blockNumber: block.number, confirmed: false})
        );
        confirmationCounts[txId] -= 1;

        emit Revoked(txId, msg.sender);
    }

    function confirmations(uint256 txId, address owner) public view returns (bool) {
        return confirmationRecords[txId][owner].confirmed;
    }

    function isExecuted(uint256 txId) external view transactionExists(txId) returns (bool) {
        return transactions[txId].executed;
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        return confirmationCounts[txId];
    }

    function getConfirmationCountAtBlock(
        uint256 txId,
        uint256 blockNumber
    ) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function isConfirmedAtBlock(
        uint256 txId,
        address owner,
        uint256 blockNumber
    ) public view returns (bool) {
        ConfirmationCheckpoint[] storage checkpoints = confirmationHistory[txId][owner];

        for (uint256 i = checkpoints.length; i > 0; i--) {
            ConfirmationCheckpoint memory checkpoint = checkpoints[i - 1];
            if (checkpoint.blockNumber <= blockNumber) {
                return checkpoint.confirmed;
            }
        }

        return false;
    }

    function executeTransaction(
        uint256 txId
    ) external onlyOwner transactionExists(txId) nonReentrantExecution {
        Transaction storage txn = transactions[txId];
        require(!txn.executed, "Already executed");

        require(confirmationCounts[txId] >= required, "Not enough confirmations");

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        require(
            confirmationCounts[txId] >= required,
            "Confirmations changed during execution"
        );

        txn.executed = true;
        emit Executed(txId);
    }

    receive() external payable {}
}
