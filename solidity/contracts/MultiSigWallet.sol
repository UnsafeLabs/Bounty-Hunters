// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract MultiSigWallet {
    address[] public owners; uint256 public required; uint256 public transactionCount; bool private _locked;
    struct Transaction { address to; uint256 value; bytes data; bool executed; }
    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(uint256 => mapping(address => uint256)) public confirmationTime;
    mapping(address => bool) public isOwner; 
    event Submitted(uint256 indexed); event Confirmed(uint256 indexed, address indexed);
    event Executed(uint256 indexed); event Revoked(uint256 indexed, address indexed);
    modifier onlyOwner() { require(isOwner[msg.sender], "Not owner"); _; }
    modifier noReentrant() { require(!_locked, "Re"); _locked = true; _; _locked = false; }
    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners"); require(_required > 0 && _required <= _owners.length, "Bad req");
        for (uint256 i = 0; i < _owners.length; i++) isOwner[_owners[i]] = true;
        owners = _owners; required = _required;
    }
    function submitTransaction(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256) {
        require(to != address(0), "Zero addr");
        uint256 txId = transactionCount++;
        transactions[txId] = Transaction(to, value, data, false);
        emit Submitted(txId); return txId;
    }
    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Exec"); require(!confirmations[txId][msg.sender], "Conf");
        confirmations[txId][msg.sender] = true; confirmationTime[txId][msg.sender] = block.number;
        emit Confirmed(txId, msg.sender);
    }
    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Exec"); require(confirmations[txId][msg.sender], "Not conf");
        confirmations[txId][msg.sender] = false; confirmationTime[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) if (confirmations[txId][owners[i]]) count++;
    }
    function executeTransaction(uint256 txId) external onlyOwner noReentrant {
        require(!transactions[txId].executed, "Exec"); require(getConfirmationCount(txId) >= required, "Not enough");
        Transaction storage txn = transactions[txId]; txn.executed = true;
        (bool success,) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Fail"); emit Executed(txId);
    }
    receive() external payable {}
}
