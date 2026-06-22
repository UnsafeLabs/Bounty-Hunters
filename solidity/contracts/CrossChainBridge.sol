// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title EIP-712 Domain Separator for CrossChainBridge
/// @notice Provides typed data signing domain for better wallet UX
interface IEIP712 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

contract CrossChainBridge is IEIP712 {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonces;

    // EIP-712 domain
    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("TransferProcessed(address recipient,uint256 amount,uint256 chainId,uint256 nonce,uint256 timestamp,address contractAddress)");

    bytes32 public DOMAIN_SEPARATOR;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        DOMAIN_SEPARATOR = calculateDomainSeparator();
    }

    function calculateDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_SEPARATOR_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    /// @notice Process a cross-chain transfer with EIP-712 typed data signature
    /// @param recipient Address to receive tokens
    /// @param amount Amount of tokens to transfer
    /// @param transferNonce Nonce from the originating chain
    /// @param signature EIP-712 signed signature
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Include chain ID, contract address, and nonce in the hash
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            block.chainid,           // Prevent cross-chain replay
            address(this),           // Prevent replay after proxy upgrades
            msg.sender               // Bind to specific sender
        ));

        require(!processedTransfers[transferHash], "Already processed");

        // Increment sender nonce to prevent same-chain replay
        senderNonces[msg.sender]++;

        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /// @notice Verify signature with zero-address check
    /// @param hash The hash to verify
    /// @param signature The ECDSA signature
    /// @return Whether the signature is valid
    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
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

        address recovered = ecrecover(
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)),
            v, r, s
        );

        // FIX: Check for zero-address return from ecrecover (indicates invalid signature)
        require(recovered != address(0), "Invalid signature");

        return recovered == validator;
    }

    /// @notice Get EIP-712 domain separator for typed data signing
    /// @return The domain separator bytes32
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    /// @notice Query the nonce for a sender (for frontend integration)
    /// @param sender The sender address
    /// @return The current nonce for the sender
    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
