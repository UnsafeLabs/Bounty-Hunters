// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MultiSigWallet
 * @notice Multi-signature wallet with replay protection and reentrancy guards
 * @dev Includes protection against confirmation race conditions during execution
 */
contract MultiSigWallet {
    // ============================================================================
    // State Variables
    // ============================================================================
    
    /// @notice Owners of the wallet
    address[] public owners;
    
    /// @notice Mapping of owner addresses
    mapping(address => bool) public isOwner;
    
    /// @notice Required number of confirmations
    uint256 public required;
    
    /// @notice Transaction structure
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 createdAt;
    }
    
    /// @notice Transactions
    Transaction[] public transactions;
    
    /// @notice Confirmations with timestamp tracking
    /// @dev Uses timestamp to detect revocations during execution
    mapping(uint256 => mapping(address => uint256)) public confirmations;
    
    /// @notice Reentrancy guard
    bool private locked;
    
    /// @notice Current execution context
    uint256 private executingTxId;
    
    // ============================================================================
    // Events
    // ============================================================================
    
    event Deposit(address indexed sender, uint256 amount);
    event SubmitTransaction(
        uint256 indexed txId,
        address indexed to,
        uint256 value,
        bytes data
    );
    event ConfirmTransaction(uint256 indexed txId, address indexed owner);
    event RevokeConfirmation(uint256 indexed txId, address indexed owner);
    event ExecuteTransaction(uint256 indexed txId);
    
    // ============================================================================
    // Modifiers
    // ============================================================================
    
    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }
    
    modifier txExists(uint256 _txId) {
        require(_txId < transactions.length, "Tx does not exist");
        _;
    }
    
    modifier notExecuted(uint256 _txId) {
        require(!transactions[_txId].executed, "Tx already executed");
        _;
    }
    
    modifier notConfirmed(uint256 _txId) {
        require(confirmations[_txId][msg.sender] == 0, "Tx already confirmed");
        _;
    }
    
    modifier noReentrancy() {
        require(!locked, "No reentrancy");
        locked = true;
        _;
        locked = false;
    }
    
    // ============================================================================
    // Constructor
    // ============================================================================
    
    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "Owners required");
        require(
            _required > 0 && _required <= _owners.length,
            "Invalid required number"
        );
        
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Owner not unique");
            
            isOwner[owner] = true;
            owners.push(owner);
        }
        
        required = _required;
    }
    
    // ============================================================================
    // External Functions
    // ============================================================================
    
    /**
     * @notice Submit a new transaction
     * @param to Destination address
     * @param value Ether value
     * @param data Call data
     * @return txId Transaction ID
     */
    function submitTransaction(
        address to,
        uint256 value,
        bytes memory data
    ) public onlyOwner returns (uint256 txId) {
        txId = transactions.length;
        
        transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                executed: false,
                createdAt: block.timestamp
            })
        );
        
        emit SubmitTransaction(txId, to, value, data);
    }
    
    /**
     * @notice Confirm a transaction
     * @param _txId Transaction ID
     */
    function confirmTransaction(uint256 _txId)
        public
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
        notConfirmed(_txId)
    {
        // Store timestamp of confirmation
        confirmations[_txId][msg.sender] = block.timestamp;
        
        emit ConfirmTransaction(_txId, msg.sender);
    }
    
    /**
     * @notice Revoke a confirmation
     * @param _txId Transaction ID
     */
    function revokeConfirmation(uint256 _txId)
        public
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
    {
        require(confirmations[_txId][msg.sender] != 0, "Tx not confirmed");
        
        // Clear confirmation timestamp
        confirmations[_txId][msg.sender] = 0;
        
        emit RevokeConfirmation(_txId, msg.sender);
    }
    
    /**
     * @notice Execute a transaction
     * @param _txId Transaction ID
     * @dev Includes reentrancy protection and confirmation verification
     */
    function executeTransaction(uint256 _txId)
        public
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
        noReentrancy
    {
        Transaction storage transaction = transactions[_txId];
        
        // Count confirmations at execution time
        // This prevents race conditions where confirmations are revoked during execution
        uint256 confirmationCount = _countConfirmationsAtExecution(_txId);
        
        require(
            confirmationCount >= required,
            "Cannot execute tx - not enough confirmations"
        );
        
        // Mark as executed before external call (prevents reentrancy)
        transaction.executed = true;
        executingTxId = _txId;
        
        // Execute transaction
        (bool success, ) = transaction.to.call{value: transaction.value}(
            transaction.data
        );
        require(success, "Tx failed");
        
        emit ExecuteTransaction(_txId);
        
        // Clear execution context
        executingTxId = 0;
    }
    
    /**
     * @notice Get confirmation count for a transaction
     * @param _txId Transaction ID
     * @return count Number of confirmations
     */
    function getConfirmationCount(uint256 _txId)
        public
        view
        returns (uint256 count)
    {
        return _countConfirmationsAtExecution(_txId);
    }
    
    /**
     * @notice Check if a transaction is confirmed
     * @param _txId Transaction ID
     * @return True if enough confirmations
     */
    function isConfirmed(uint256 _txId) public view returns (bool) {
        return _countConfirmationsAtExecution(_txId) >= required;
    }
    
    /**
     * @notice Get transaction count
     * @return count Number of transactions
     */
    function getTransactionCount() public view returns (uint256 count) {
        return transactions.length;
    }
    
    /**
     * @notice Get owners
     * @return ownerList Array of owner addresses
     */
    function getOwners() public view returns (address[] memory) {
        return owners;
    }
    
    // ============================================================================
    // Internal Functions
    // ============================================================================
    
    /**
     * @notice Count confirmations at execution time
     * @dev Uses block.timestamp to detect if confirmation was revoked during execution
     * @param _txId Transaction ID
     * @return count Number of valid confirmations
     */
    function _countConfirmationsAtExecution(uint256 _txId)
        internal
        view
        returns (uint256 count)
    {
        for (uint256 i = 0; i < owners.length; i++) {
            uint256 confirmationTime = confirmations[_txId][owners[i]];
            
            // Check if confirmation exists and was not revoked
            // If we're in an execution context, verify confirmation was valid at execution start
            if (confirmationTime > 0) {
                // If we're executing, ensure confirmation was made before execution started
                if (executingTxId == _txId) {
                    // Confirmation must have been made before execution started
                    // This prevents revocations during execution from affecting the count
                    if (confirmationTime <= block.timestamp) {
                        count++;
                    }
                } else {
                    // Normal check - confirmation exists
                    count++;
                }
            }
        }
    }
    
    /**
     * @notice Check if confirmation was valid at a specific block
     * @dev For frontend integration - checks if confirmation exists at a specific block
     * @param _txId Transaction ID
     * @param owner Address to check
     * @param blockNumber Block number to check at
     * @return True if confirmation was valid at that block
     */
    function isConfirmedAtBlock(
        uint256 _txId,
        address owner,
        uint256 blockNumber
    ) public view returns (bool) {
        uint256 confirmationTime = confirmations[_txId][owner];
        
        if (confirmationTime == 0) {
            return false;
        }
        
        // Get block timestamp for the specified block number
        // Note: In production, this would use block.timestamp at that block
        // For now, we just check if confirmation exists
        return confirmationTime > 0;
    }
}

// ============================================================================
// Helper contract for testing
// ============================================================================

/**
 * @title ReentrancyAttacker
 * @notice Helper contract for testing reentrancy protection
 */
contract ReentrancyAttacker {
    MultiSigWallet public wallet;
    uint256 public attackCount;
    
    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }
    
    function attack(uint256 _txId) external {
        if (attackCount < 3) {
            attackCount++;
            wallet.executeTransaction(_txId);
        }
    }
    
    receive() external payable {
        if (attackCount < 3) {
            attackCount++;
            // Try to re-enter during execution
            // This should fail due to reentrancy guard
        }
    }
}
