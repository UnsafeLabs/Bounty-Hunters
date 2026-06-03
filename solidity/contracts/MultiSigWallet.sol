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
    // Changed: confirmations now store the block number when confirmed, 0 if not confirmed
    mapping(uint256 => mapping(address => uint256)) public confirmations;
    mapping(address => bool) public isOwner;

    // Reentrancy guard state
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
        _status = _NOT_ENTERED;
    }

    // Fixed: zero-address validation added
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

    // Updated to store block number instead of boolean
    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender] == 0, "Already confirmed");
        confirmations[txId][msg.sender] = block.number;
        emit Confirmed(txId, msg.sender);
    }

    // Updated to reset block number to 0
    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender] != 0, "Not confirmed");
        confirmations[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    // Updated to count non-zero block number entries
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]] != 0) {
                count++;
            }
        }
    }

    /// @notice Checks if the transaction had at least `required` confirmations as of a given block number
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            uint256 confirmedBlock = confirmations[txId][owners[i]];
            if (confirmedBlock != 0 && confirmedBlock <= blockNumber) {
                count++;
            }
        }
        return count >= required;
    }

    // Fixed: added reentrancy protection
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
