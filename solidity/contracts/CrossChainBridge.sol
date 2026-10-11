// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CrossChainBridge
 * @notice Bridges token transfers between chains using a validator signature scheme.
 *
 * Replay-attack hardening (issue #920):
 *  - Signed messages are EIP-712 typed data whose domain binds name, version,
 *    chainId and verifyingContract, so a signature valid on one chain is invalid
 *    on another chain and invalid again after a proxy upgrade changes the
 *    verifying contract address.
 *  - A per-sender nonce that increments on each transfer prevents same-chain
 *    replay of the same message.
 *  - ecrecover's zero-address result (invalid signature) is explicitly rejected.
 */
contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    // Global nonce kept for backwards compatibility with initiateTransfer events.
    uint256 public nonce;

    // Per-sender nonce: increments on each processed transfer for that sender.
    mapping(address => uint256) public senderNonces;

    mapping(bytes32 => bool) public processedTransfers;

    // EIP-712 domain values.
    string public constant EIP712_NAME = "CrossChainBridge";
    string public constant EIP712_VERSION = "1";

    // keccak256("Transfer(address recipient,uint256 amount,uint256 nonce,uint256 targetChain)")
    bytes32 public constant TRANSFER_TYPEHASH =
        0x156e49669fe49aac45e9f90dee1607c6cce6da9d7f86b2d94f91fd6add496458;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    /// @dev EIP-712 domain separator, recomputed live so it changes with chain id
    ///      and with the contract address (proxy upgrades).
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(EIP712_NAME)),
                keccak256(bytes(EIP712_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    /// @dev Canonical EIP-712 struct hash for a transfer message.
    function transferStructHash(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 targetChain
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                recipient,
                amount,
                transferNonce,
                targetChain
            )
        );
    }

    /// @dev Full EIP-712 digest: 0x19 0x01 domainSeparator structHash.
    function transferDigest(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 targetChain
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                transferStructHash(recipient, amount, transferNonce, targetChain)
            )
        );
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    /**
     * @notice Release a bridged transfer to `recipient`.
     * @dev The signed digest binds recipient, amount, per-sender nonce, target
     *      chain, chain id (via domain) and contract address (via domain), so:
     *      - cross-chain replay is impossible (chainId differs),
     *      - same-chain replay is impossible (sender nonce must match),
     *      - post-upgrade replay is impossible (verifyingContract differs).
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 targetChain,
        bytes calldata signature
    ) external {
        require(amount > 0, "Amount must be > 0");

        // Same-chain replay guard: the message must carry this sender's current nonce.
        require(transferNonce == senderNonces[recipient], "Invalid sender nonce");

        bytes32 digest = transferDigest(recipient, amount, transferNonce, targetChain);

        // Defense-in-depth: also guard the full digest against reprocessing.
        require(!processedTransfers[digest], "Already processed");

        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[digest] = true;
        senderNonces[recipient]++;

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    /// @notice Nonce queryable per sender for frontend integration.
    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    /**
     * @dev Verifies an EIP-712 signature against the validator.
     *      Rejects malformed signatures and the ecrecover zero-address result.
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

        // Enforce canonical s and valid v before recovery.
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid signature v value");
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "Invalid signature s value"
        );

        address recovered = ecrecover(digest, v, r, s);

        // ecrecover returns address(0) for an invalid signature — reject it.
        require(recovered != address(0), "Invalid signature");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
