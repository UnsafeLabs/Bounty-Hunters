// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract MultiSigWallet is ReentrancyGuard {
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
    mapping(address => bool) public isOwner;

    // Block-level confirmation tracking for front-running protection
    mapping(uint256 => mapping(address => uint256)) public confirmationBlock;
    mapping(uint256 => mapping(address => uint256)) public revocationBlock;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactionCount, "Transaction does not exist");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Zero address owner");
            require(!isOwner[_owners[i]], "Duplicate owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Cannot send to zero address");
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
        revocationBlock[txId][msg.sender] = 0;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner txExists(txId) {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        revocationBlock[txId][msg.sender] = block.number;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    /// @notice Check if a transaction had enough confirmations at a specific block number.
    ///         Prevents front-running attacks by verifying historical confirmation state.
    function isConfirmedAtBlock(uint256 txId, uint256 _block) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            bool wasConfirmed = confirmationBlock[txId][owners[i]] != 0
                && confirmationBlock[txId][owners[i]] <= _block;
            bool wasRevoked = revocationBlock[txId][owners[i]] != 0
                && revocationBlock[txId][owners[i]] <= _block;
            if (wasConfirmed && !wasRevoked) {
                count++;
            }
        }
        return count >= required;
    }

    /// @notice Execute a confirmed transaction. Protected against reentrancy by the
    ///         nonReentrant modifier and the executed flag. State changes (executed=true)
    ///         occur before the external call following the Checks-Effects-Interactions pattern.
    ///         Block-level confirmation check prevents front-running revocation attacks.
    function executeTransaction(uint256 txId) external onlyOwner txExists(txId) nonReentrant {
        Transaction storage txn = transactions[txId];

        // Checks
        require(!txn.executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");
        // Front-running protection: confirmations must have been valid at the previous block
        require(isConfirmedAtBlock(txId, block.number - 1), "Confirmations not stable at previous block");

        // Effects — state changes BEFORE external call (CEI pattern)
        txn.executed = true;

        // Interactions — external call last
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
