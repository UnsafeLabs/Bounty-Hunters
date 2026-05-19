// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CrossChainBridge {
    using ECDSA for bytes32;

    IERC20 public bridgeToken;
    address public validator;
    
    // Per-sender nonce to prevent same-chain replay
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonces[msg.sender]++);
    }

    /**
     * @dev Process a transfer with full replay protection:
     * 1. Chain ID: Prevents cross-chain replay
     * 2. Contract Address: Prevents replay after proxy upgrades
     * 3. Nonce: Prevents same-chain replay
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Construct hash with domain separation
        bytes32 transferHash = keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            recipient,
            amount,
            transferNonce
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
        address recovered = MessageHashUtils.toEthSignedMessageHash(hash).recover(signature);
        require(recovered != address(0), "Invalid signature source");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
