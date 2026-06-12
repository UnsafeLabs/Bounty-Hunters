// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CrossChainBridge is EIP712 {
    using ECDSA for bytes32;

    IERC20 public bridgeToken;
    address public validator;
    
    // Nonce per sender to prevent same-chain replay
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedTransfers;

    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce)"
    );

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) EIP712("CrossChainBridge", "1") {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonces[msg.sender]++);
    }

    /**
     * @dev Processes a cross-chain transfer using EIP-712 structured signature.
     * Prevents replay attacks by including chainId, contract address, and sender-specific nonces.
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Construct the structured hash (includes Domain Separator which has chainId and contract address)
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce
        ));

        bytes32 digest = _hashTypedDataV4(structHash);

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[digest] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    /**
     * @dev Verifies that the digest was signed by the authorized validator.
     * Uses OpenZeppelin's ECDSA to prevent signature malleability and handles zero-address check.
     */
    function verifySignature(bytes32 digest, bytes calldata signature) public view returns (bool) {
        address recovered = digest.recover(signature);
        require(recovered != address(0), "Invalid signature");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    /**
     * @dev Expose domain separator for frontend integration.
     */
    function domainSeparatorV4() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
