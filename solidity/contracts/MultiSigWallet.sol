// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;
    bool private locked;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    struct Confirmation {
        bool active;
        uint40 timestamp;
        uint64 confirmedBlock;
        uint64 revokedBlock;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier noReentrancy() {
        require(!locked, "No reentrancy");
        locked = true;
        _;
        locked = false;
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
        require(to != address(0), "Zero address target");
        if (data.length > 0) {
            uint32 size;
            assembly {
                size := extcodesize(to)
            }
            require(size > 0, "Target has no code");
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

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!locked, "Mutation locked");
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].active, "Already confirmed");
        
        confirmations[txId][msg.sender] = Confirmation({
            active: true,
            timestamp: uint40(block.timestamp),
            confirmedBlock: uint64(block.number),
            revokedBlock: 0
        });
        
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!locked, "Mutation locked");
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].active, "Not confirmed");
        
        confirmations[txId][msg.sender].active = false;
        confirmations[txId][msg.sender].revokedBlock = uint64(block.number);
        
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].active) count++;
        }
    }

    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        Confirmation memory conf = confirmations[txId][owner];
        if (conf.confirmedBlock > 0 && conf.confirmedBlock <= blockNumber) {
            if (conf.revokedBlock == 0 || conf.revokedBlock > blockNumber) {
                return true;
            }
        }
        return false;
    }

    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) {
                count++;
            }
        }
        return count >= required;
    }

    function executeTransaction(uint256 txId) external onlyOwner noReentrancy {
        require(!transactions[txId].executed, "Already executed");
        require(getConfirmationCount(txId) >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        require(getConfirmationCount(txId) >= required, "Confirmations revoked during execution");

        emit Executed(txId);
    }

    receive() external payable {}
}
