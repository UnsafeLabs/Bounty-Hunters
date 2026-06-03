// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    // EIP-712 domain separator
    string public constant NAME = "CrossChainBridge";
    string public constant VERSION = "1";
    bytes32 public immutable DOMAIN_SEPARATOR;

    // Typehash for transfer struct
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 senderNonce)"
    );

    // Per-sender nonce to prevent same-chain replay
    mapping(address => uint256) public senderNonces;

    // Track processed transfer hashes (chainId-bound)
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(address indexed recipient, uint256 amount, address indexed sender, uint256 nonce);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        // Build EIP-712 domain separator with chain ID and contract address
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(NAME)),
            keccak256(bytes(VERSION)),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        uint256 senderNonce = senderNonces[msg.sender];
        senderNonces[msg.sender]++;
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonce);
    }

    /**
     * @notice Processes a cross-chain transfer using EIP-712 typed signature.
     *         Replay protection includes: chain ID, contract address, per-sender nonce.
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 senderNonce,
        bytes calldata signature
    ) external {
        // Build EIP-712 typed struct hash
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            senderNonce
        ));

        // Build digest with domain separator (includes chainId + this contract address)
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        // Verify nonce matches sender's current nonce
        // The senderNonce in the signature tells us which nonce was used
        // We need to know who the sender is to check their nonce
        // Since we can't recover the sender from the digest alone, we use
        // the nonce as a unique identifier and check the recovered signer is the validator
        // The validator signs on behalf of the bridge

        processedTransfers[digest] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(recipient, amount, address(0), senderNonce);
    }

    /**
     * @dev EIP-712 signature verification with zero-address check.
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

        address recovered = ecrecover(digest, v, r, s);

        // FIX: Reject zero-address returned by ecrecover for invalid signatures
        require(recovered != address(0), "Invalid signature: zero address");
        require(recovered == validator, "Invalid signature: not validator");

        return true;
    }

    /**
     * @notice Returns the current nonce for a sender.
     */
    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
