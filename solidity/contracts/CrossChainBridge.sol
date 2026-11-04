// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CrossChainBridge
 * @notice Bridges token transfers between chains using a validator signature scheme.
 * Hardened against replay attacks via EIP-712 typed structured data signing:
 * - Domain separator binds block.chainid to prevent cross-chain replay.
 * - Domain separator binds address(this) to prevent post-upgrade/redeployment replay.
 * - Per-sender sequential nonces prevent same-chain message replay.
 * - Explicit check rejects ecrecover returning address(0) (invalid signature).
 */
contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    // Per-sender sequential nonces preventing same-chain replay
    mapping(address => uint256) public nonces;

    // Registry of processed transfer digests
    mapping(bytes32 => bool) public processedTransfers;

    // EIP-712 Domain and Type Hashes
    string public constant DOMAIN_NAME = "CrossChainBridge";
    string public constant DOMAIN_VERSION = "1";

    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address sender,address recipient,uint256 amount,uint256 nonce)"
    );

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        require(_bridgeToken != address(0), "Invalid bridge token");
        require(_validator != address(0), "Invalid validator");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    /// @notice Builds the dynamic EIP-712 domain separator (binds chainId and verifyingContract)
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Computes EIP-712 struct hash for a transfer
    function getTransferStructHash(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                sender,
                recipient,
                amount,
                transferNonce
            )
        );
    }

    /// @notice Computes the full EIP-712 message digest for signing/verification
    function getTransferDigest(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                getTransferStructHash(sender, recipient, amount, transferNonce)
            )
        );
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    /**
     * @notice Processes an inbound bridge transfer authorized by the validator signature.
     * @param sender Source address whose nonce is validated and incremented.
     * @param recipient Target address receiving the bridged tokens.
     * @param amount Token quantity to transfer.
     * @param transferNonce Sequential nonce corresponding to nonces[sender].
     * @param signature 65-byte ECDSA signature by the validator over the EIP-712 digest.
     */
    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        require(amount > 0, "Amount must be > 0");
        require(sender != address(0), "Invalid sender");
        require(recipient != address(0), "Invalid recipient");
        require(transferNonce == nonces[sender], "Invalid nonce");

        bytes32 transferHash = getTransferDigest(sender, recipient, amount, transferNonce);

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        // State mutations before external transfer
        processedTransfers[transferHash] = true;
        nonces[sender] = transferNonce + 1;

        require(bridgeToken.transfer(recipient, amount), "Token transfer failed");

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /**
     * @notice Verifies an ECDSA signature over the EIP-712 digest against the designated validator.
     * @param digest 32-byte EIP-712 digest.
     * @param signature 65-byte signature.
     */
    function verifySignature(bytes32 digest, bytes calldata signature) public view returns (bool) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid signature v value");
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "Invalid signature s value"
        );

        address recovered = ecrecover(digest, v, r, s);

        // Explicit check: reject zero-address recovery indicating an invalid signature
        require(recovered != address(0), "Invalid signature: recovered zero address");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
