// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CrossChainBridge
 * @notice Fix: Cross-chain replay attack in signature verification (#920)
 *
 * Problem: Signatures verified without chain ID inclusion allow
 * replay across different chains (Ethereum mainnet → L2 fork).
 *
 * Solution: Include chainId in EIP-712 domain separator,
 * add chain-specific nonce, validate chainId matches current chain.
 */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CrossChainBridge is EIP712 {
    using ECDSA for bytes32;

    // EIP-712 type hash for bridge messages
    bytes32 public constant BRIDGE_MESSAGE_TYPEHASH =
        keccak256("BridgeMessage(address sender,address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId,uint256 targetChainId)");

    // Chain ID at deployment — detects chain splits
    uint256 public immutable DEPLOYED_CHAIN_ID;

    // Per-chain nonces to prevent replay
    mapping(uint256 => mapping(address => uint256)) public chainNonces;

    // Processed message hashes — double protection
    mapping(bytes32 => bool) public processedMessages;

    event BridgeMessageProcessed(
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 nonce
    );

    event ReplayAttackPrevented(
        address indexed attacker,
        uint256 sourceChainId,
        uint256 nonce
    );

    error ChainIdMismatch(uint256 expected, uint256 actual);
    error InvalidChainId(uint256 chainId);
    error ReplayDetected(bytes32 messageHash);
    error InvalidSignature();

    constructor() EIP712("CrossChainBridge", "1.0.0") {
        DEPLOYED_CHAIN_ID = block.chainid;
    }

    /**
     * @notice Verify and process a cross-chain bridge message
     * @param sender Source chain sender
     * @param recipient Target chain recipient
     * @param amount Token amount
     * @param sourceChainId Source chain ID
     * @param nonce Per-chain nonce
     * @param signature Signer's signature
     */
    function processMessage(
        address sender,
        address recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 nonce,
        bytes calldata signature
    ) external {
        // 1. Validate target chain ID matches current chain
        if (sourceChainId == block.chainid) {
            revert InvalidChainId(sourceChainId);
        }

        // 2. Verify nonce matches expected per-chain nonce
        if (nonce != chainNonces[sourceChainId][sender]) {
            revert ReplayDetected(_computeHash(sender, recipient, amount, nonce, sourceChainId));
        }

        // 3. Compute EIP-712 typed struct hash (includes chainId in domain)
        bytes32 structHash = keccak256(abi.encode(
            BRIDGE_MESSAGE_TYPEHASH,
            sender,
            recipient,
            amount,
            nonce,
            sourceChainId,
            block.chainid  // targetChainId — prevents cross-chain replay
        ));

        bytes32 digest = _hashTypedDataV4(structHash);

        // 4. Recover and verify signer
        address signer = digest.recover(signature);
        if (signer != sender) {
            revert InvalidSignature();
        }

        // 5. Check for duplicate processing
        bytes32 messageHash = _computeHash(sender, recipient, amount, nonce, sourceChainId);
        if (processedMessages[messageHash]) {
            revert ReplayDetected(messageHash);
        }

        // 6. Mark as processed, increment nonce
        processedMessages[messageHash] = true;
        chainNonces[sourceChainId][sender]++;

        emit BridgeMessageProcessed(sender, recipient, amount, sourceChainId, nonce);
    }

    /**
     * @notice Check if deployed chain ID still matches current chain ID
     * @dev Detects chain forks where chainId may have changed
     */
    function verifyChainIntegrity() external view returns (bool) {
        return DEPLOYED_CHAIN_ID == block.chainid;
    }

    function _computeHash(
        address sender,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 sourceChainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(sender, recipient, amount, nonce, sourceChainId));
    }
}
