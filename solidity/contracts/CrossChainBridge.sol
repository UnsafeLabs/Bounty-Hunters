// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title CrossChainBridge
 * @notice Facilitates cross-chain token transfers with validator signature verification.
 * @dev Implements EIP-712 typed data signing and per-sender nonces to prevent
 *      cross-chain, same-chain, and post-upgrade replay attacks.
 *
 * Fixes applied (issue #920):
 *   1. Added block.chainid to signed hash → prevents cross-chain replay
 *   2. Added per-sender nonce → prevents same-chain replay
 *   3. Added address(this) via EIP-712 domain separator → prevents post-upgrade replay
 *   4. Added zero-address check on ecrecover → rejects invalid signatures
 *   5. Full EIP-712 typed data signing for structured, wallet-friendly verification
 */
contract CrossChainBridge is EIP712 {
    using ECDSA for bytes32;

    IERC20 public bridgeToken;
    address public validator;
    uint256 public globalNonce;

    /// @notice Per-sender nonce to prevent same-chain replay attacks.
    mapping(address => uint256) public senderNonces;

    /// @notice Tracks processed transfer hashes to prevent double-processing.
    mapping(bytes32 => bool) public processedTransfers;

    /// @dev EIP-712 typehash for the Transfer struct.
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce,uint256 sourceChain)"
    );

    event TransferInitiated(
        address indexed sender,
        uint256 amount,
        uint256 targetChain,
        uint256 nonce
    );
    event TransferProcessed(
        bytes32 indexed transferHash,
        address indexed recipient,
        uint256 amount
    );

    /**
     * @param _bridgeToken Address of the ERC20 token to bridge.
     * @param _validator   Address of the off-chain validator that signs transfer proofs.
     */
    constructor(
        address _bridgeToken,
        address _validator
    ) EIP712("CrossChainBridge", "2") {
        require(_bridgeToken != address(0), "Invalid token address");
        require(_validator != address(0), "Invalid validator address");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    /**
     * @notice Locks tokens on this chain and emits an event for the validator to observe.
     * @param amount      Number of tokens to bridge.
     * @param targetChain Chain ID of the destination chain.
     */
    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        require(targetChain != block.chainid, "Cannot bridge to same chain");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, globalNonce++);
    }

    /**
     * @notice Processes an incoming bridge transfer signed by the validator.
     * @dev The signature must cover an EIP-712 digest that includes chain ID,
     *      contract address (via domain separator), per-sender nonce, and transfer details.
     *
     * @param recipient     Address to receive the bridged tokens.
     * @param amount        Number of tokens to release.
     * @param transferNonce Per-sender nonce — must match senderNonces[recipient].
     * @param sourceChain   Chain ID where the transfer was initiated.
     * @param signature     65-byte ECDSA signature from the validator.
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 sourceChain,
        bytes calldata signature
    ) external {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(
            transferNonce == senderNonces[recipient],
            "Invalid nonce"
        );

        // Build EIP-712 struct hash — includes chain ID via domain separator
        // and contract address, preventing cross-chain and post-upgrade replay.
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                recipient,
                amount,
                transferNonce,
                sourceChain
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);

        // Verify the EIP-712 signature is from the authorized validator.
        // ECDSA.recover reverts on zero-address (invalid signature).
        address recovered = ECDSA.recover(digest, signature);
        require(recovered == validator, "Invalid signature");

        // Mark as processed to prevent replay
        require(!processedTransfers[digest], "Already processed");
        processedTransfers[digest] = true;

        // Increment per-sender nonce — prevents same-chain replay
        senderNonces[recipient]++;

        // Transfer tokens to recipient
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    /**
     * @notice Returns the current nonce for a given sender.
     * @dev Frontend integration: query this before constructing a transfer message.
     * @param sender Address to query.
     * @return Current nonce value.
     */
    function getNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    /**
     * @notice Returns the bridge pool balance.
     * @return Token balance held by this contract.
     */
    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    /**
     * @notice Returns the EIP-712 domain separator used for signature verification.
     * @dev Useful for frontend integration and debugging.
     * @return The domain separator bytes32 value.
     */
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
