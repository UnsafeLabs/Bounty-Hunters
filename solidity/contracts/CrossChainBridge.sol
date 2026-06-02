// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CrossChainBridge
 * @notice Secure cross-chain token bridge with replay protection
 * @dev Fixes:
 *   - Chain ID in signed hash prevents cross-chain replay
 *   - Per-sender nonce prevents same-chain replay
 *   - Contract address in hash prevents post-upgrade replay
 *   - ecrecover zero-address check rejects invalid signatures
 *   - EIP-712 typed data signing for structured verification
 *   - SafeERC20 for all transfers
 *   - ReentrancyGuard on all external functions
 *   - Ownable for access control
 */
contract CrossChainBridge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public bridgeToken;
    address public validator;

    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedTransfers;

    // EIP-712
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public DOMAIN_SEPARATOR;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

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

    /**
     * @notice Initiate cross-chain transfer
     * @param amount Amount to transfer
     * @param targetChain Target chain ID
     */
    function initiateTransfer(uint256 amount, uint256 targetChain) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 senderNonce = nonces[msg.sender];
        nonces[msg.sender] = senderNonce + 1;
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonce);
    }

    /**
     * @notice Process cross-chain transfer with full replay protection
     * @param recipient Recipient address
     * @param amount Amount to transfer
     * @param transferNonce Transfer nonce
     * @param signature Validator signature
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external nonReentrant {
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(recipient, amount, transferNonce, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.safeTransfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /**
     * @notice Verify EIP-712 signature with replay protection
     * @param recipient Recipient address
     * @param amount Amount
     * @param transferNonce Nonce
     * @param signature Signature bytes
     * @return True if signature is valid
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

        // EIP-712 typed data hash with chainId and contract address
        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
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
}
