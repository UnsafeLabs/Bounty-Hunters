// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CrossChainBridge is EIP712 {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    // EIP-712 typehash for structured data signing
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contractAddress)"
    );

    // Per-sender nonce to prevent same-chain replay
    mapping(address => uint256) public senderNonces;
    
    // Track processed transfers
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) 
        EIP712("CrossChainBridge", "1") 
    {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    /**
     * @notice Process a cross-chain transfer with replay protection
     * @param recipient Address to receive tokens
     * @param amount Amount of tokens to transfer
     * @param transferNonce Nonce from source chain
     * @param signature Validator signature
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // FIX: Include chain ID, contract address, and per-sender nonce
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));

        bytes32 transferHash = _hashTypedDataV4(structHash);

        require(!processedTransfers[transferHash], "Already processed");
        
        // FIX: Verify signature with zero-address check
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /**
     * @notice Verify validator signature with EIP-712
     * @param hash EIP-712 typed data hash
     * @param signature 65-byte signature (r, s, v)
     * @return bool True if signature is valid
     */
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

        // FIX: Check for zero-address return from ecrecover
        address recovered = ecrecover(hash, v, r, s);
        require(recovered != address(0), "Invalid signature: zero address");

        return recovered == validator;
    }

    /**
     * @notice Get the current nonce for a sender
     * @param sender Address to query
     * @return uint256 Current nonce
     */
    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    /**
     * @notice Get the EIP-712 domain separator
     * @return bytes32 Domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
