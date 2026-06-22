// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title CrossChainBridge
 * @notice Bridge for token transfers between chains using validator signature verification.
 * @dev Uses EIP-712 typed data signing to prevent cross-chain replay, same-chain replay,
 *      and post-upgrade replay attacks. The EIP-712 domain separator includes chainId
 *      and verifyingContract address, binding each signature to a specific chain and contract.
 */
contract CrossChainBridge is EIP712 {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public globalNonce;

    /// @notice Per-recipient nonce to prevent same-chain replay
    /// @dev Strictly increasing; a transfer with nonce <= senderNonces[recipient] is rejected
    mapping(address => uint256) public senderNonces;

    /// @notice Tracks processed transfer hashes for additional safety
    mapping(bytes32 => bool) public processedTransfers;

    /// @dev EIP-712 typehash for the Transfer struct
    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce)"
    );

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    /**
     * @param _bridgeToken The ERC20 token to bridge
     * @param _validator The address authorized to sign transfer approvals
     */
    constructor(address _bridgeToken, address _validator)
        EIP712("CrossChainBridge", "1")
    {
        require(_bridgeToken != address(0), "Invalid token address");
        require(_validator != address(0), "Invalid validator address");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    /**
     * @notice Initiates a cross-chain transfer by locking tokens in the contract
     * @param amount Amount of tokens to transfer
     * @param targetChain Chain ID of the destination chain
     */
    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, globalNonce++);
    }

    /**
     * @notice Processes a cross-chain transfer with EIP-712 signature verification
     * @dev The signature is bound to:
     *       - Chain ID (via EIP-712 domain separator) → prevents cross-chain replay
     *       - Contract address (via EIP-712 verifyingContract) → prevents post-upgrade replay
     *       - Per-recipient nonce → prevents same-chain replay
     * @param recipient Address to receive the transferred tokens
     * @param amount Amount of tokens to transfer
     * @param nonce Unique nonce for this recipient (must be strictly increasing)
     * @param signature Validator's EIP-712 signature over the transfer struct
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(signature.length == 65, "Invalid signature length");

        // Prevent same-chain replay: nonce must be strictly increasing per recipient
        require(nonce > senderNonces[recipient], "Nonce already used");

        // Build the EIP-712 typed data hash
        // _hashTypedDataV4 includes chainId and verifyingContract via domain separator
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);

        // ECDSA.recover reverts on invalid signatures, protecting against zero-address
        address recovered = ECDSA.recover(digest, signature);
        require(recovered == validator, "Invalid signature: not validator");

        bytes32 transferHash = keccak256(abi.encode(recipient, amount, nonce));

        // Double-check against duplicate processing (defense in depth)
        require(!processedTransfers[transferHash], "Transfer already processed");

        // Mark as processed and update recipient nonce
        processedTransfers[transferHash] = true;
        senderNonces[recipient] = nonce;

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /**
     * @notice Returns the EIP-712 typed data hash for a transfer
     * @dev Public so frontends/dApps can compute the hash for signing
     */
    function getTransferDigest(
        address recipient,
        uint256 amount,
        uint256 nonce
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            nonce
        ));
        return _hashTypedDataV4(structHash);
    }

    /**
     * @notice Verifies a raw EIP-712 signature against the validator's address
     * @dev Returns false (not reverts) for invalid signatures, including zero-address ecrecover
     */
    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
        if (signature.length != 65) return false;

        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(hash, signature);
        return err == ECDSA.RecoverError.NoError && recovered != address(0) && recovered == validator;
    }

    /**
     * @notice Returns the total token balance held by this contract
     */
    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    /**
     * @notice Returns the EIP-712 domain separator
     * @dev Includes chainId and verifyingContract to bind signatures
     */
    function domainSeparatorV4() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
