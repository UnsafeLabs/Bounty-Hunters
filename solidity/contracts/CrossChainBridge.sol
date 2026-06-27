// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CrossChainBridge is EIP712 {
    IERC20 public bridgeToken;
    address public validator;

    // FIX: Per-sender nonce to prevent same-chain replay
    mapping(address => uint256) public nonces;

    // FIX: Processed transfers tracking with full replay protection
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    // FIX: EIP-712 typed data for structured signature verification
    struct TransferData {
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint256 sourceChainId;
        address contractAddress;
    }

    // EIP-712 type hash
    bytes32 private constant TRANSFER_TYPEHASH =
        keccak256("TransferData(address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId,address contractAddress)");

    constructor(address _bridgeToken, address _validator)
        EIP712("CrossChainBridge", "1.0")
    {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        // FIX: Per-sender nonce
        emit TransferInitiated(msg.sender, amount, targetChain, nonces[msg.sender]++);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // FIX: Include chain ID, contract address, and nonce in hash
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            block.chainid,          // FIX: prevents cross-chain replay
            address(this)           // FIX: prevents replay after upgrade
        ));

        require(!processedTransfers[transferHash], "Already processed");

        // FIX: EIP-712 structured data verification
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));

        bytes32 typedDataHash = _hashTypedDataV4(structHash);

        require(verifySignature(typedDataHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // FIX: Check for zero-address return from ecrecover
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

        address recovered = ecrecover(hash, v, r, s);

        // FIX: Explicit zero-address check — ecrecover returns address(0) on invalid input
        require(recovered != address(0), "Invalid signature: ecrecover returned zero address");

        return recovered == validator;
    }

    // FIX: Nonce queryable per sender for frontend integration
    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
