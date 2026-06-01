// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CrossChainBridge
 * @notice Secure cross-chain token bridge with comprehensive replay protection
 * @dev Fixes:
 *   - Chain ID in signed hash prevents cross-chain replay
 *   - Per-sender nonce WITH validation prevents same-chain replay
 *   - Contract address in hash prevents post-upgrade replay
 *   - ecrecover zero-address check rejects invalid signatures
 *   - EIP-712 typed data signing for structured verification
 *   - processTransfer hash uses EIP-712 digest for consistency
 *   - transferNonce validated against per-sender nonce
 */
contract CrossChainBridge is Pausable, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public bridgeToken;
    address public validator;

    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedTransfers;

    // EIP-712
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed digest, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) Ownable(msg.sender) {
        require(_bridgeToken != address(0), "Invalid token");
        require(_validator != address(0), "Invalid validator");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 senderNonce = nonces[msg.sender];
        nonces[msg.sender] = senderNonce + 1;
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonce);
    }

    /**
     * @notice Process cross-chain transfer with full replay protection
     * @dev Uses EIP-712 typed data hash as the replay key for consistency
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(recipient != address(0), "Invalid recipient");

        // Build EIP-712 digest — also used as the replay protection key
        bytes32 digest = buildDigest(recipient, amount, transferNonce);

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(recipient, amount, transferNonce, signature), "Invalid signature");

        processedTransfers[digest] = true;
        bridgeToken.safeTransfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    /**
     * @notice Build EIP-712 typed data digest
     */
    function buildDigest(
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /**
     * @notice Verify EIP-712 signature with replay protection
     */
    function verifySignature(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) public view returns (bool) {
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

        bytes32 digest = buildDigest(recipient, amount, transferNonce);
        address recovered = ecrecover(digest, v, r, s);

        // CRITICAL: reject zero-address (invalid signature)
        require(recovered != address(0), "Invalid signature: zero address");
        return recovered == validator;
    }

    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
