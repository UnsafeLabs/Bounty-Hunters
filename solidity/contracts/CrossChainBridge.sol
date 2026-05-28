// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    // Per-sender nonce tracking to prevent same-chain replay
    mapping(address => uint256) public senderNonces;

    mapping(bytes32 => bool) public processedTransfers;

    error ZeroAmount();
    error InvalidSignatureLength();
    error InvalidSignature();
    error AlreadyProcessed();

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        if (amount == 0) {
            revert ZeroAmount();
        }
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    // Fix: Include chainId, contract address, and sender nonce in hash to prevent replay
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        address sender,
        bytes calldata signature
    ) external {
        // Include chainId, contract address, and sender to prevent cross-chain and cross-contract replay
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            sender,
            block.chainid,        // prevents cross-chain replay
            address(this)         // prevents replay after contract upgrade
        ));

        if (processedTransfers[transferHash]) {
            revert AlreadyProcessed();
        }

        // Verify sender nonce to prevent same-chain replay
        require(transferNonce == senderNonces[sender], "Invalid nonce");

        if (!verifySignature(transferHash, signature)) {
            revert InvalidSignature();
        }

        processedTransfers[transferHash] = true;
        senderNonces[sender]++; // increment sender nonce
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // Fix: Check for zero-address return from ecrecover
    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
        if (signature.length != 65) {
            revert InvalidSignatureLength();
        }

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

        // Fix: Check for zero-address return from ecrecover (invalid signature)
        if (recovered == address(0)) {
            return false;
        }

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
