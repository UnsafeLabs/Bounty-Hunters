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

    // Confirmation with timestamp for front-running protection
    struct Confirmation {
        bool confirmed;
        uint256 timestamp;
        uint256 blockNumber;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
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
            require(_owners[i] != address(0), "Zero address owner");
            require(!isOwner[_owners[i]], "Duplicate owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    /// @notice Submit a new transaction for confirmation
    /// @param to Destination address (must not be zero)
    /// @param value ETH value to send
    /// @param data Calldata for the destination
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero address destination");

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

    /// @notice Confirm a pending transaction
    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].confirmed, "Already confirmed");

        confirmations[txId][msg.sender] = Confirmation({
            confirmed: true,
            timestamp: block.timestamp,
            blockNumber: block.number
        });
        emit Confirmed(txId, msg.sender);
    }

    /// @notice Revoke a previously given confirmation
    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");

        confirmations[txId][msg.sender] = Confirmation({
            confirmed: false,
            timestamp: 0,
            blockNumber: 0
        });
        emit Revoked(txId, msg.sender);
    }

    /// @notice Count current confirmations for a transaction
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    /// @notice Check if an owner had confirmed at a specific block (front-running protection)
    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNum) public view returns (bool) {
        Confirmation storage c = confirmations[txId][owner];
        return c.confirmed && c.blockNumber <= blockNum;
    }

    /// @notice Count confirmations as of a specific block
    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNum) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation storage c = confirmations[txId][owners[i]];
            if (c.confirmed && c.blockNumber <= blockNum) count++;
        }
    }

    /// @notice Execute a confirmed transaction with reentrancy protection
    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
