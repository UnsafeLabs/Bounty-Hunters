// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CrossChainBridge {
    address public owner;

    // Nonce per sender to prevent same-chain replay
    mapping(address => uint256) public nonces;

    // EIP-712 domain separator
    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address from,uint256 amount,uint256 nonce)"
    );

    event TransferProcessed(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 nonce
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        // EIP-712 domain includes chain ID and contract address to prevent cross-chain
        // and post-upgrade replay attacks.
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("CrossChainBridge"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Processes a cross‑chain token transfer.
    /// @param from   Sender address (must match the signer).
    /// @param to     Recipient address.
    /// @param amount Amount to transfer.
    /// @param nonce  Unique nonce for the sender (must equal current nonces[from]).
    /// @param signature  ECDSA signature (v, r, s) packed in a 65‑byte array.
    function processTransfer(
        address from,
        address to,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external {
        // Replay protection: nonce must match the sender’s current nonce.
        require(nonce == nonces[from], "Invalid nonce");

        // Build the EIP‑712 typed data hash.
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_TYPEHASH, from, amount, nonce)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        // Extract v, r, s from the 65‑byte signature.
        require(signature.length == 65, "Invalid signature length");
        uint8 v = uint8(signature[64]);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);

        address signer = ecrecover(digest, v, r, s);

        // ecrecover returns address(0) for invalid signatures.
        require(signer != address(0) && signer == from, "Invalid signature");

        // Increment nonce to prevent replay of the same message.
        nonces[from] = nonce + 1;

        // Emit event and perform the actual transfer logic (omitted for brevity).
        emit TransferProcessed(from, to, amount, nonce);
    }

    /// @notice Verifies a raw ECDSA signature. Provided for compatibility,
    ///         but the main path now uses EIP‑712 via `processTransfer`.
    /// @param hash     The original signed message hash.
    /// @param signature  ECDSA signature bytes.
    /// @return signer   The recovered address (address(0) if invalid).
    function verifySignature(bytes32 hash, bytes calldata signature)
        external
        pure
        returns (address)
    {
        if (signature.length != 65) return address(0);
        uint8 v = uint8(signature[64]);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        address signer = ecrecover(hash, v, r, s);
        // Returns address(0) for invalid signatures – caller must check.
        return signer;
    }

    /// @notice Allows the owner to upgrade the contract (e.g., proxy pattern).
    ///         Domain separator includes `address(this)`, so old signatures
    ///         become invalid automatically after an upgrade.
    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}