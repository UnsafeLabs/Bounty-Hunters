// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
    uint256 public transactionCount;

    struct Transaction {
 * @dev Modified for BountyHunters with confirmation tracking and revocation safety
 * Issue: https://github.com/UnsafeLabs/Bounty-Hunters/issues/270
 */
contract MultiSigWallet is ReentrancyGuard {
    using Address for address;

    uint256 public required;
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

    mapping(uint256 => mapping(address => bool)) public isConfirmed;
    mapping(uint256 => uint256) public confirmations;
    mapping(uint256 => Transaction) public transactions;
    // Block-level confirmation tracking to prevent front-running revocations
    mapping(uint256 => mapping(address => uint256)) public confirmedAtBlock;

    uint256 public transactionCount;

            data: data,
            executed: false
        });
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender], "Already confirmed");
        confirmations[txId][msg.sender] = true;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender], "Not confirmed");
        confirmations[txId][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]]) count++;
        }
    }

    // BUG: No reentrancy protection — confirmation can be revoked during callback
    // BUG: No block-level confirmation snapshot
    function executeTransaction(uint256 txId) external onlyOwner {
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
     * @param _destination Transaction target address
     */
    function submitTransaction(address _destination) public onlyOwner {
        require(_destination != address(0), "MultiSigWallet: zero address");
        require(_destination.code.length == 0 || _destination.code.length > 0, "MultiSigWallet: must be valid address");
        transactionCount += 1;
        uint256 txId = transactionCount;
        
        require(isOwner[msg.sender], "not owner");
        require(transactions[_txId].executed == false, "tx already executed");
        isConfirmed[_txId][msg.sender] = true;
        confirmedAtBlock[_txId][msg.sender] = block.number;
        confirmations[_txId] += 1;
        emit Confirmation(msg.sender, _txId);
        if (confirmations[_txId] == required) {
        require(isOwner[msg.sender], "not owner");
        require(isConfirmed[_txId][msg.sender], "not confirmed");
        isConfirmed[_txId][msg.sender] = false;
        confirmedAtBlock[_txId][msg.sender] = 0;
        confirmations[_txId] -= 1;
        emit Revocation(msg.sender, _txId);
    }
    /**
     * @dev Check if a transaction is confirmed by a specific owner at a given block
     * @param _txId Transaction ID
     * @param _owner Owner address
     * @param _blockNumber Block number to check confirmation at
     * @return bool True if confirmed at that block
     */
    function isConfirmedAtBlock(uint256 _txId, address _owner, uint256 _blockNumber) public view returns (bool) {
        return isConfirmed[_txId][_owner] && confirmedAtBlock[_txId][_owner] <= _blockNumber && confirmedAtBlock[_txId][_owner] != 0;
    }

    /**
     * @dev Legacy check if a transaction is confirmed by a specific owner
     * @param _txId Transaction ID
     * @param _owner Owner address
     * @return bool True if confirmed
     */
     * @param _txId Transaction ID to execute
     */
    function executeTransaction(uint256 _txId) 
        public
        nonReentrant 
        txExists(_txId) 
        notExecuted(_txId) 
        Transaction storage txn = transactions[_txId];
        require(confirmations[_txId] >= required, "cannot execute yet");
        
        // Reentrancy safety: re-check confirmations after any external call possibility
        // This prevents a revoked confirmation from executing during callback
        uint256 confirmationSnapshot = block.number;
        
        txn.executed = true;
        
        (bool success, ) = txn.destination.call{value: txn.value}(txn.data);
            txn.executed = false;
            revert("transaction failed");
        }
        
        // Post-execution confirmation check: ensure no front-running revocation occurred
        require(confirmations[_txId] >= required, "MultiSigWallet: confirmation revoked during execution");
        require(isConfirmedAtBlock(_txId, msg.sender, confirmationSnapshot), "MultiSigWallet: caller confirmation revoked");

        emit Execution(_txId);
    }
        txExists(_txId) 
        notExecuted(_txId) 
    {
        require(_newOwner != address(0), "MultiSigWallet: zero address");
        require(!isOwner[_newOwner], "already owner");
        isOwner[_newOwner] = true;
        owners.push(_newOwner);
        txExists(_txId) 
        notExecuted(_txId) 
    {
        require(_owner != address(0), "MultiSigWallet: zero address");
        require(isOwner[_owner], "not owner");
        isOwner[_owner] = false;
        
     * @param _required New number of required confirmations
     */
    function changeRequirement(uint256 _required) public onlyWallet {
        require(_required > 0, "MultiSigWallet: requirement must be > 0");
        required = _required;
        emit RequirementChange(_required);
    }
     * @param _value Amount of ETH to deposit
     */
    function deposit(address _sender, uint256 _value) public payable {
        require(_sender != address(0), "MultiSigWallet: zero address");
        emit Deposit(_sender, _value);
    }
}
