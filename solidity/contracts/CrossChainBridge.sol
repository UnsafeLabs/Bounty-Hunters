// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title CrossChainBridge
 * @notice Facilitates token transfers between chains using validator signatures
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;
    address public validator;
    uint256 public transferCount;
    
    // EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;
    
    // EIP-712 type hashes
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 chainId,address contractAddress)"
    );
    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    
    // Nonce tracking per sender to prevent same-chain replay
    mapping(address => uint256) public nonces;
    
    // Track used signatures to prevent exact replay (defense in depth)
    mapping(bytes32 => bool) public usedSignatures;
    
    // Events
    event TransferProcessed(
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 nonce,
        uint256 chainId
    );
    
    struct TransferRequest {
        address sender;
        address recipient;
    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
    
    constructor(address _validator) {
        validator = _validator;
        
        // Construct EIP-712 domain separator
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }
    
    /**
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    // BUG: No chain ID in hash — cross-chain replay possible
    // BUG: No nonce per sender — same-chain replay possible
     * @param v Recovery byte
     */
    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        bytes32 r,
    ) external {
        uint8 v
    ) external {
        // Build the message hash
        uint256 nonce = nonces[sender];
        bytes32 messageHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                sender,
                recipient,
                amount,
                nonce,
                block.chainid,
                address(this)
            )
        );
        
        // EIP-712 structured hash
        bytes32 structuredHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                messageHash
            )
        );
        
        // Verify signature
        require(verifySignature(structuredHash, r, s, v), "Invalid signature");
        
        // Prevent exact signature replay (defense in depth)
        require(!usedSignatures[structuredHash], "Signature already used");
        usedSignatures[structuredHash] = true;
        
        // Increment nonce for sender
        nonces[sender]++;
        
        // Execute transfer logic
        _executeTransfer(sender, recipient, amount);
        
        transferCount++;
        
        emit TransferProcessed(sender, recipient, amount, nonce, block.chainid);
    }
    
    /**
    }

    // BUG: Does not check for zero-address return from ecrecover
    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;
     * @param s Signature part
     * @param v Recovery byte
     */
    function verifySignature(
        bytes32 messageHash,
        bytes32 r,
        bytes32 s,
        if (v < 27) v += 27;

        // Recover signer address
        address signer = ecrecover(messageHash, v, r, s);
        
        // Reject invalid signatures (ecrecover returns zero address for invalid signatures)
        require(signer != address(0), "Invalid signature: zero address");
        
        // Check if recovered signer is the authorized validator
        return signer == validator;
    }
        return recovered == validator;
    }
     * @notice Execute the token transfer
     * @dev Internal function to perform the actual transfer
     */
    function _executeTransfer(address sender, address recipient, uint256 amount) internal {
        // Transfer implementation would go here
        // This is a placeholder for the actual token transfer logic
        // Uses sender instead of msg.sender to prevent replay attacks
    }
    
    /**
    function updateValidator(address newValidator) external {
        validator = newValidator;
    }
    
    /**
     * @notice Get the current nonce for a sender
     * @param sender The address to query
     * @return The current nonce for the sender
     */
    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }
}
