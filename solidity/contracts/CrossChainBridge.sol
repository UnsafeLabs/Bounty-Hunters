// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CrossChainBridge
 * @notice Facilitates token transfers between chains using validator signatures
 * @dev Fixed: cross-chain replay attack, same-chain replay via nonces, ecrecover zero-address check, EIP-712 signing
 */
contract CrossChainBridge {
    /// @notice EIP-712 type hash for Transfer struct
    bytes32 private constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address sender,address token,uint256 amount,uint256 targetChainId,uint256 nonce)");

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice Tracks used nonces per sender to prevent replay
    mapping(address => uint256) public nonces;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public balances;

    address[] public validators;
    uint256 public requiredConfirmations;

    event TransferProcessed(
        address indexed sender,
        address indexed token,
        uint256 amount,
        uint256 targetChainId
    );

    event Deposited(address indexed from, address indexed token, uint256 amount);

    constructor(address[] memory _validators, uint256 _requiredConfirmations) {
        require(_validators.length > 0, "No validators");
        require(
            _requiredConfirmations > 0 && _requiredConfirmations <= _validators.length,
            "Invalid required confirmations"
        );
        validators = _validators;
        requiredConfirmations = _requiredConfirmations;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @notice Deposit tokens for cross-chain transfer
     */
    function deposit(address token, uint256 amount) external {
        require(amount > 0, "Zero amount");
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /**
     * @notice Process a cross-chain transfer with signature verification
     * @dev Includes chain ID, nonce, and contract address in hash to prevent replay attacks
     * @param sender Address of the sender on the source chain
     * @param token Token address
     * @param amount Token amount
     * @param targetChainId Destination chain ID
     * @param signatures Array of validator signatures
     */
    function processTransfer(
        address sender,
        address token,
        uint256 amount,
        uint256 targetChainId,
        bytes[] calldata signatures
    ) external {
        require(targetChainId == block.chainid, "Wrong chain");
        require(signatures.length >= requiredConfirmations, "Not enough signatures");

        uint256 nonce = nonces[sender];

        // Build EIP-712 typed data hash
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                sender,
                token,
                amount,
                targetChainId,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        // Also include chain ID + contract address in hash for replay-proof processedTransfers tracking
        bytes32 transferId = keccak256(
            abi.encode(block.chainid, address(this), sender, token, amount, targetChainId, nonce)
        );
        require(!processedTransfers[transferId], "Already processed");

        // Verify signatures
        address lastSigner = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = verifySignature(digest, signatures[i]);
            require(signer > lastSigner, "Signers not sorted or duplicate");
            require(isValidator(signer), "Not a validator");
            lastSigner = signer;
        }

        // Mark as processed and increment nonce
        processedTransfers[transferId] = true;
        unchecked {
            nonces[sender] = nonce + 1;
        }

        balances[sender] += amount;

        emit TransferProcessed(sender, token, amount, targetChainId);
    }

    /**
     * @notice Verify an EIP-712 signature
     * @dev Rejects ecrecover zero-address (invalid signature)
     */
    function verifySignature(bytes32 digest, bytes memory signature)
        internal
        pure
        returns (address)
    {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        // EIP-2: v must be 27 or 28
        require(v == 27 || v == 28, "Invalid v");

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature");

        return signer;
    }

    function isValidator(address validator) internal view returns (bool) {
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i] == validator) {
                return true;
            }
        }
        return false;
    }
}
