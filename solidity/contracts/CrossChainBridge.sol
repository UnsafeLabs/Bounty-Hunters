// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public globalNonce;

    // EIP-712 domain separator
    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce)"
    );

    bytes32 public domainSeparator;

    // Per-sender nonce tracking to prevent same-chain replay
    mapping(address => uint256) public senderNonce;

    // Track processed transfer hashes (EIP-712 digest)
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        domainSeparator = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, globalNonce++);
    }

    /// @notice Processes a transfer with replay protection.
    /// Uses EIP-712 typed data signing for structured signature verification.
    /// The signed message includes chain ID, contract address, and per-sender nonce
    /// to prevent cross-chain, same-chain, and post-upgrade replay attacks.
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 _senderNonce,
        bytes calldata signature
    ) external {
        // Reject zero-address recipient
        require(recipient != address(0), "Invalid recipient");

        // Track per-sender nonce to prevent same-chain replay
        require(_senderNonce == senderNonce[recipient], "Invalid nonce");

        // Build EIP-712 typed struct hash
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            _senderNonce
        ));

        // Full EIP-712 digest: includes chain ID + contract address
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator,
            structHash
        ));

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[digest] = true;
        senderNonce[recipient]++;

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    /// @notice Verifies an EIP-712 typed signature.
    /// Includes explicit zero-address check for ecrecover.
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
        require(recovered != address(0), "Invalid signature: zero address");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
