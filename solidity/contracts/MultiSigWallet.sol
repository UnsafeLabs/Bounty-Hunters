// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Confirmation {
        bool confirmed;
        uint256 confirmedAtBlock;
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
    mapping(uint256 => uint256) public confirmedAtBlock;

    uint256 private _executingTxId;
    bool private _executing;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(!_executing, "Reentrant call");
        _executing = true;
        _;
        _executing = false;
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
        require(to != address(0), "Invalid to address");
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({to: to, value: value, data: data, executed: false});
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].confirmed, "Already confirmed");
        require(!_executing || txId != _executingTxId, "Cannot modify during execution");
        confirmations[txId][msg.sender] = Confirmation({confirmed: true, confirmedAtBlock: block.number});
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");
        require(!_executing || txId != _executingTxId, "Cannot modify during execution");
        confirmations[txId][msg.sender] = Confirmation({confirmed: false, confirmedAtBlock: 0});
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation storage c = confirmations[txId][owners[i]];
            if (c.confirmed && c.confirmedAtBlock <= blockNumber) count++;
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        uint256 snapshotBlock = block.number;
        confirmedAtBlock[txId] = snapshotBlock;
        require(getConfirmationCountAtBlock(txId, snapshotBlock) >= required, "Not enough confirmations");
        _executingTxId = txId;
        Transaction storage txn = transactions[txId];
        txn.executed = true;
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");
        _executingTxId = 0;
        emit Executed(txId);
    }

    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        return getConfirmationCountAtBlock(txId, blockNumber) >= required;
    }

    receive() external payable {}
}
