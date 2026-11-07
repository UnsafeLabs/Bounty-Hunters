// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

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

    // FIX: Enhanced confirmation tracking with timestamp and block number
    struct Confirmation {
        bool confirmed;
        uint64 timestamp;
        uint64 blockNumber;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner, uint256 blockNumber);
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
            require(_owners[i] != address(0), "Invalid owner");
            require(!isOwner[_owners[i]], "Duplicate owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    /**
     * @notice Submit a new transaction
     * @param to Target address
     * @param value ETH value to send
     * @param data Calldata to execute
     * @return txId Transaction ID
     */
    function submitTransaction(address to, uint256 value, bytes calldata data) 
        external 
        onlyOwner 
        returns (uint256) 
    {
        // FIX: Zero-address validation
        require(to != address(0), "Invalid recipient");
        
        // FIX: Code-size check for contract targets
        if (data.length > 0) {
            uint256 size;
            assembly { size := extcodesize(to) }
            require(size > 0, "Target must be contract for data calls");
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

    /**
     * @notice Confirm a transaction
     * @param txId Transaction ID to confirm
     */
    function confirmTransaction(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].confirmed, "Already confirmed");
        
        // FIX: Store confirmation with timestamp and block number
        confirmations[txId][msg.sender] = Confirmation({
            confirmed: true,
            timestamp: uint64(block.timestamp),
            blockNumber: uint64(block.number)
        });
        
        emit Confirmed(txId, msg.sender, block.number);
    }

    /**
     * @notice Revoke a confirmation
     * @param txId Transaction ID to revoke
     */
    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");
        confirmations[txId][msg.sender].confirmed = false;
        emit Revoked(txId, msg.sender);
    }

    /**
     * @notice Get confirmation count for a transaction
     * @param txId Transaction ID
     * @return count Number of confirmations
     */
    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    /**
     * @notice Check if transaction is confirmed as of a specific block
     * @param txId Transaction ID
     * @param blockNumber Block number to check against
     * @return bool True if confirmed at or before the specified block
     */
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) 
        public 
        view 
        returns (bool) 
    {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation memory conf = confirmations[txId][owners[i]];
            if (conf.confirmed && conf.blockNumber <= blockNumber) {
                count++;
            }
        }
        return count >= required;
    }

    /**
     * @notice Execute a confirmed transaction
     * @param txId Transaction ID to execute
     */
    function executeTransaction(uint256 txId) 
        external 
        onlyOwner 
        nonReentrant // FIX: Reentrancy guard
    {
        require(!transactions[txId].executed, "Already executed");
        
        // FIX: Snapshot confirmation count before execution
        uint256 confirmationCount = getConfirmationCount(txId);
        require(confirmationCount >= required, "Not enough confirmations");

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        // Execute external call
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        // FIX: Verify confirmations weren't revoked during execution
        require(
            getConfirmationCount(txId) >= confirmationCount,
            "Confirmations revoked during execution"
        );

        emit Executed(txId);
    }

    /**
     * @notice Get confirmation details for an owner
     * @param txId Transaction ID
     * @param owner Owner address
     * @return confirmed Whether owner confirmed
     * @return timestamp Confirmation timestamp
     * @return blockNumber Confirmation block number
     */
    function getConfirmationDetails(uint256 txId, address owner) 
        external 
        view 
        returns (bool confirmed, uint256 timestamp, uint256 blockNumber) 
    {
        Confirmation memory conf = confirmations[txId][owner];
        return (conf.confirmed, conf.timestamp, conf.blockNumber);
    }

    receive() external payable {}
}
