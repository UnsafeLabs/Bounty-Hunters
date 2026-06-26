// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract MultiSigWallet {
    address[] public owners;
    uint256 public transactionCount;
    uint public required;

    mapping(uint => Transaction) public transactions;
    // confirmations[txId][owner] => block number when confirmed (0 if not confirmed)
    mapping(uint => mapping(address => uint)) public confirmations;
    mapping(uint => bool) public executed;

    uint public transactionCount;

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
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

    }

    function submitTransaction(address to, uint value, bytes memory data) public onlyOwner returns (uint txId) {
        require(to != address(0), "MultiSigWallet: zero address");
        if (to.code.length > 0) {
            // target is a contract, additional validation could be added here
        }
        txId = transactionCount;
        transactions[txId] = Transaction({
            to: to,
            data: data,
            executed: false
        });
        emit Submitted(txId);
        return txId;
    }
    }

    function confirmTransaction(uint txId) public onlyOwner txExists(txId) notExecuted(txId) notConfirmed(txId) {
        confirmations[txId][msg.sender] = block.number;
        emit Confirmation(msg.sender, txId);
    }


        require(confirmations[txId][msg.sender], "MultiSigWallet: not confirmed");
        uint count = 0;
        for (uint i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]] > 0) {
                count++;
            }
        }
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            revert("MultiSigWallet: cannot revoke, would drop below required");
        }

        confirmations[txId][msg.sender] = 0;
        emit Revocation(msg.sender, txId);
    }

        require(!transactions[txId].executed, "Already executed");
        uint count = 0;
        for (uint i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]] > 0) {
                count++;
            }
        }
        require(success, "Execution failed");

    }

    function isConfirmedAtBlock(uint txId, uint blockNum) public view txExists(tx) returns (bool) {
        uint count = 0;
        for (uint i = 0; i < owners.length; i++) {
            uint confBlock = confirmations[txId][owners[i]];
            if (confBlock > 0 && confBlock <= blockNum) {
                count++;
            }
        }
        return count >= required;
    }

    function getOwners() public view returns (address[] memory) {
        return owners;
    }
        return transactions[txId];
    }

    function executeTransaction(uint txId) public onlyOwner txExists(txId) notExecuted(txId) nonReentrant {
        require(getConfirmationCount(txId) >= required, "MultiSigWallet: not enough confirmations");

        // Re-check confirmations after external call to prevent revocation during callback
        (bool success, ) = transactions[txId].to.call{value: transactions[txId].value}(transactions[txId].data);
        require(success, "MultiSigWallet: execution failed");

        // Post-execution check: ensure confirmations weren't revoked during the call
        require(getConfirmationCount(txId) >= required, "MultiSigWallet: confirmations revoked during execution");

        executed[txId] = true;
        emit Execution(txId);
    }

    function addOwner(address owner) public onlyOwner {
    function removeOwner(address owner) public onlyOwner {
        isOwner[owner] = false;
    }

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor() {
        _status = _NOT_ENTERED;
    }
}
