// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title CrossChainBridge
 * @notice Facilitates token transfers between chains using validator signature scheme
 * @dev Includes protection against cross-chain and same-chain replay attacks
 */
contract CrossChainBridge {
    // ============================================================================
    // State Variables
    // ============================================================================
    
    /// @notice Chain ID for EIP-712 domain separator
    uint256 public immutable chainId;
    
    /// @notice Contract address for EIP-712 domain separator
    address public immutable verifyingContract;
    
    /// @notice Nonce per sender to prevent same-chain replay
    mapping(address => uint256) public nonces;
    
    /// @notice Processed transfer hashes to prevent duplicate processing
    mapping(bytes32 => bool) public processedTransfers;
    
    /// @notice Validator addresses authorized to sign transfers
    mapping(address => bool) public validators;
    
    /// @notice Required number of validator confirmations
    uint256 public requiredConfirmations;
    
    /// @notice EIP-712 domain separator
    bytes32 public domainSeparator;
    
    // ============================================================================
    // EIP-712 Type Hashes
    // ============================================================================
    
    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId,uint256 destChainId)"
    );
    
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    
    // ============================================================================
    // Events
    // ============================================================================
    
    event TransferProcessed(
        bytes32 indexed transferId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 destChainId
    );
    
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    
    // ============================================================================
    // Constructor
    // ============================================================================
    
    constructor(uint256 _requiredConfirmations) {
        chainId = block.chainid;
        verifyingContract = address(this);
        requiredConfirmations = _requiredConfirmations;
        
        // Initialize EIP-712 domain separator
        domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }
    
    // ============================================================================
    // External Functions
    // ============================================================================
    
    /**
     * @notice Process a cross-chain transfer with validator signatures
     * @param sender Address of the sender on the source chain
     * @param recipient Address of the recipient on the destination chain
     * @param amount Amount of tokens to transfer
     * @param sourceChainId Chain ID of the source chain
     * @param signatures Array of validator signatures
     */
    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 sourceChainId,
        bytes[] calldata signatures
    ) external {
        // Get current nonce for sender
        uint256 nonce = nonces[sender];
        
        // Create transfer hash with replay protection
        bytes32 transferHash = _createTransferHash(
            sender,
            recipient,
            amount,
            nonce,
            sourceChainId,
            block.chainid
        );
        
        // Check if transfer has already been processed
        require(!processedTransfers[transferHash], "Transfer already processed");
        
        // Verify signatures
        require(_verifySignatures(transferHash, signatures), "Invalid signatures");
        
        // Mark transfer as processed
        processedTransfers[transferHash] = true;
        
        // Increment nonce for sender (prevents same-chain replay)
        nonces[sender] = nonce + 1;
        
        // Emit event
        emit TransferProcessed(
            transferHash,
            sender,
            recipient,
            amount,
            sourceChainId,
            block.chainid
        );
        
        // TODO: Execute actual token transfer
        // This would involve calling the token contract to transfer tokens
    }
    
    /**
     * @notice Get the current nonce for a sender
     * @param sender Address to query nonce for
     * @return Current nonce
     */
    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }
    
    /**
     * @notice Check if a transfer has been processed
     * @param transferHash Hash of the transfer to check
     * @return True if transfer has been processed
     */
    function isTransferProcessed(bytes32 transferHash) external view returns (bool) {
        return processedTransfers[transferHash];
    }
    
    // ============================================================================
    // Internal Functions
    // ============================================================================
    
    /**
     * @notice Create a transfer hash with replay protection
     * @dev Includes sender, recipient, amount, nonce, sourceChainId, and destChainId
     */
    function _createTransferHash(
        address sender,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 sourceChainId,
        uint256 destChainId
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            sender,
            recipient,
            amount,
            nonce,
            sourceChainId,
            destChainId
        ));
    }
    
    /**
     * @notice Create EIP-712 typed data hash
     * @dev Follows EIP-712 specification for structured data signing
     */
    function _createEIP712Hash(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator,
            structHash
        ));
    }
    
    /**
     * @notice Verify an array of validator signatures
     * @param transferHash Hash of the transfer to verify
     * @param signatures Array of signatures to verify
     * @return True if enough valid signatures are provided
     */
    function _verifySignatures(
        bytes32 transferHash,
        bytes[] calldata signatures
    ) internal view returns (bool) {
        require(signatures.length >= requiredConfirmations, "Not enough signatures");
        
        // Create EIP-712 hash for signature verification
        bytes32 eip712Hash = _createEIP712Hash(transferHash);
        
        address lastSigner = address(0);
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recoverSigner(eip712Hash, signatures[i]);
            
            // Check that signer is a validator
            require(validators[signer], "Invalid validator");
            
            // Check that signatures are in ascending order (prevents duplicate signatures)
            require(signer > lastSigner, "Duplicate or unordered signatures");
            
            lastSigner = signer;
        }
        
        return true;
    }
    
    /**
     * @notice Recover signer address from signature
     * @param hash Hash that was signed
     * @param signature Signature to recover from
     * @return Recovered signer address
     */
    function _recoverSigner(
        bytes32 hash,
        bytes calldata signature
    ) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        
        // Normalize v value
        if (v < 27) {
            v += 27;
        }
        
        require(v == 27 || v == 28, "Invalid signature v value");
        
        // Recover signer
        address signer = ecrecover(hash, v, r, s);
        
        // Check for zero address (invalid signature)
        require(signer != address(0), "Invalid signature: zero address");
        
        return signer;
    }
    
    // ============================================================================
    // Admin Functions (for testing/deployment)
    // ============================================================================
    
    /**
     * @notice Add a validator (only for testing - in production this would be governed)
     * @param validator Address to add as validator
     */
    function addValidator(address validator) external {
        validators[validator] = true;
        emit ValidatorAdded(validator);
    }
    
    /**
     * @notice Remove a validator (only for testing - in production this would be governed)
     * @param validator Address to remove as validator
     */
    function removeValidator(address validator) external {
        validators[validator] = false;
        emit ValidatorRemoved(validator);
    }
}
