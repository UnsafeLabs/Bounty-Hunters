// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title CrossChainBridge — Secured
 * @notice Cross-chain bridge with replay attack protection via EIP-712,
 *         per-sender nonces, chain ID binding, and signature validation.
 *
 * Fixes applied for Issue #920:
 * 1. EIP-712 typed structured data signing
 * 2. block.chainid in the hash → prevents cross-chain replay
 * 3. address(this) in the hash → prevents post-upgrade replay
 * 4. per-sender nonces → prevents same-chain replay
 * 5. ecrecover zero-address check → prevents invalid signature acceptance
 */
contract CrossChainBridge is EIP712 {
    IERC20 public bridgeToken;
    address public validator;

    // ── FIX #4: Per-sender nonces ────────────────────────────────────────────
    mapping(address => uint256) public nonces;

    // ── Legacy nonce tracking (kept for migration compatibility) ─────────────
    mapping(bytes32 => bool) public processedTransfers;

    // ── EIP-712 Domain ───────────────────────────────────────────────────────
    bytes32 private constant _PROCESS_TRANSFER_TYPEHASH =
        keccak256(
            "ProcessTransfer("
            "address recipient,"
            "uint256 amount,"
            "uint256 senderNonce,"
            "address sender"
            ")"
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
     * @param _bridgeToken ERC20 token address for bridging
     * @param _validator   Address authorized to sign transfer approvals
     */
    constructor(
        address _bridgeToken,
        address _validator
    ) EIP712("CrossChainBridge", "1") {
        require(_bridgeToken != address(0), "Bridge token zero-address");
        require(_validator != address(0), "Validator zero-address");

        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    /**
     * @notice Initiate a cross-chain token transfer.
     * @param amount      Amount of tokens to bridge
     * @param targetChain Destination chain ID
     */
    function initiateTransfer(
        uint256 amount,
        uint256 targetChain
    ) external {
        require(amount > 0, "Amount must be > 0");

        uint256 currentNonce = nonces[msg.sender];
        nonces[msg.sender] = currentNonce + 1;

        bridgeToken.transferFrom(msg.sender, address(this), amount);

        emit TransferInitiated(msg.sender, amount, targetChain, currentNonce);
    }

    /**
     * @notice Process a signed cross-chain transfer.
     * @dev FIX: Uses EIP-712 typed signing with chain ID, contract address,
     *          and per-sender nonce binding.
     *
     * @param recipient          Address to receive tokens
     * @param amount             Amount of tokens to transfer
     * @param senderNonce        Nonce of the sender on the source chain
     * @param sender             Original sender address
     * @param signature          EIP-712 typed signature from validator
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 senderNonce,
        address sender,
        bytes calldata signature
    ) external {
        require(recipient != address(0), "Recipient zero-address");
        require(amount > 0, "Amount must be > 0");
        require(sender != address(0), "Sender zero-address");

        // ── FIX #1, #2, #3: EIP-712 hash with chain ID + contract address ──
        // This prevents:
        //   - Cross-chain replay (chain ID bound)
        //   - Same-chain replay (nonce bound)
        //   - Post-upgrade replay (contract address bound)

        bytes32 structHash = keccak256(
            abi.encode(
                _PROCESS_TRANSFER_TYPEHASH,
                recipient,
                amount,
                senderNonce,
                sender
            )
        );

        bytes32 transferHash = _hashTypedDataV4(structHash);

        require(!processedTransfers[transferHash], "Already processed");
        require(
            _verifySignature(transferHash, signature),
            "Invalid signature"
        );

        processedTransfers[transferHash] = true;

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /**
     * @notice Verify an EIP-712 typed signature.
     * @dev FIX #5: Explicitly validates ecrecover does not return zero-address.
     *
     * @param hash      EIP-712 typed data hash
     * @param signature 65-byte signature (r, s, v)
     * @return true if signature is valid and from the validator
     */
    function _verifySignature(
        bytes32 hash,
        bytes calldata signature
    ) internal view returns (bool) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) v += 27;

        // FIX: ecrecover returns address(0) on invalid signature
        address recovered = ecrecover(hash, v, r, s);

        // FIX #5: Must reject zero-address from ecrecover
        require(recovered != address(0), "Invalid signature: zero-address");

        return recovered == validator;
    }

    /**
     * @notice Get the current nonce for a sender.
     * @param sender Address to query
     * @return Current nonce value
     */
    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    /**
     * @notice Check if a transfer hash has been processed.
     * @param transferHash Hash to check
     * @return true if already processed
     */
    function isProcessed(bytes32 transferHash) external view returns (bool) {
        return processedTransfers[transferHash];
    }

    /**
     * @notice Get the EIP-712 domain separator.
     * @return Domain separator value
     */
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Get total token balance held by the bridge.
     */
    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
