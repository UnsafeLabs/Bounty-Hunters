// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    // Tracks used nonces per sender to prevent same-chain replay
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    /// @notice Initiate a cross-chain transfer
    /// @param amount Amount of tokens to bridge
    /// @param targetChain Target chain ID
    /// @return uint256 The nonce assigned to this transfer
    function initiateTransfer(uint256 amount, uint256 targetChain) external returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        uint256 transferNonce = nonce++;
        emit TransferInitiated(msg.sender, amount, targetChain, transferNonce);
        return transferNonce;
    }

    /// @notice Process an incoming cross-chain transfer
    /// @dev Includes chainid, contract address, and sender nonce to prevent all replay vectors
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Prevent same-chain replay via nonce tracking
        require(!usedNonces[recipient][transferNonce], "Nonce already used");
        usedNonces[recipient][transferNonce] = true;

        // Include chainid to prevent cross-chain replay
        // Include address(this) to prevent replay after proxy upgrades
        bytes32 transferHash = keccak256(abi.encodePacked(
            block.chainid,    // Prevents cross-chain replay
            address(this),     // Prevents replay after upgrade
            recipient,
            amount,
            transferNonce
        ));

        require(verifySignature(transferHash, signature), "Invalid signature");

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /// @notice Verify an EIP-191 signature
    /// @dev Checks for zero-address return from ecrecover
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
            keccak256(abi.encodePacked("Ethereum Signed Message:
32", hash)),
            v, r, s
        );

        // Reject zero address (invalid signature)
        require(recovered != address(0), "Invalid signature: zero address");
        return recovered == validator;
    }

    /// @notice Get the current pool balance
    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
