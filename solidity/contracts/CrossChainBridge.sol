// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CrossChainBridge
 * @notice Fixed version — prevents cross-chain replay, same-chain replay after upgrade, and ecrecover zero-address bug
 */
contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public globalNonce;

    mapping(bytes32 => bool) public processedTransfers;
    // Per-sender nonce to prevent replay even if global nonce is known
    mapping(address => uint256) public senderNonces;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, globalNonce++);
    }

    /**
     * @notice Process a transfer with replay protection
     * @dev Fixes:
     *      1. Includes block.chainid → prevents cross-chain replay
     *      2. Includes address(this) → prevents replay after contract upgrade
     *      3. Includes per-sender nonce → prevents same-chain replay
     *      4. Validates ecrecover result → prevents zero-address bypass
     */
    function processTransfer(
        address recipient,
        uint256 amount,
        bytes calldata signature
    ) external {
        uint256 senderNonce = senderNonces[recipient];

        // FIX: Include chain ID, contract address, and per-sender nonce
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            senderNonce,
            block.chainid,    // FIX: Prevents cross-chain replay
            address(this)     // FIX: Prevents replay after contract upgrade
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        senderNonces[recipient] = senderNonce + 1; // FIX: Increment per-sender nonce
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /**
     * @notice Verify a signature
     * @dev FIX: Added require(recovered != address(0)) to prevent zero-address ecrecover bypass
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

        address recovered = ecrecover(
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)),
            v, r, s
        );

        // FIX: ecrecover returns address(0) on invalid signature
        require(recovered != address(0), "Invalid signature: ecrecover failed");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
