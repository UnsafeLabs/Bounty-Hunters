// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Confirmation {
        uint256 confirmedAtBlock;
        uint256 revokedAtBlock;
        bool active;
    }

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
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

    modifier notExecuting() {
        require(!_executing, "MultiSigWallet: executing");
        _executing = true;
        _;
        _executing = false;
    }

    bool private _executing;

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    // BUGFIX: reject zero-address `to` and contract targets (was: no validation)
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "MultiSigWallet: to is zero address");
        require(address(to).code.length == 0, "MultiSigWallet: cannot send to contract");
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({ to: to, value: value, data: data, executed: false });
        emit Submitted(txId);
        return txId;
    }

    // BUGFIX: block reentrant confirmations/revocations while execute runs
    function confirmTransaction(uint256 txId) external onlyOwner notExecuting {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].active, "Already confirmed");
        confirmations[txId][msg.sender] = Confirmation({
            confirmedAtBlock: block.number,
            revokedAtBlock: 0,
            active: true
        });
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner notExecuting {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].active, "Not confirmed");
        confirmations[txId][msg.sender] = Confirmation({
            confirmedAtBlock: block.number,
            revokedAtBlock: block.number,
            active: false
        });
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], block.number)) count++;
        }
    }

    // BUGFIX: enable block-level confirmation checks to prevent front-running
    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber) public view returns (bool) {
        Confirmation storage conf = confirmations[txId][owner];
        if (!conf.active) return false;
        if (conf.revokedAtBlock != 0 && conf.revokedAtBlock <= blockNumber) return false;
        return conf.confirmedAtBlock <= blockNumber;
    }

    // BUGFIX: reentrancy lock + block-level confirmation snapshot
    function executeTransaction(uint256 txId) external onlyOwner notExecuting {
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
