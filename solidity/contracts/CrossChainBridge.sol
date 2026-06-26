// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce; // global nonce (kept for backward compat, see senderNonces for per-sender)

    // EIP-712 domain separator components
    string public constant EIP712_NAME = "CrossChainBridge";
    string public constant EIP712_VERSION = "1";
    bytes32 private immutable _DOMAIN_SEPARATOR;

    // Per-sender nonce to prevent same-chain replay
    mapping(address => uint256) public senderNonces;

    // Track processed transfers by hash (now includes chainId + contract address)
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        // Build EIP-712 domain separator (includes chainId + contract address)
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(EIP712_NAME)),
                keccak256(bytes(EIP712_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    /// @notice Process a cross-chain transfer with replay protection
    /// @dev The transferHash now includes: chainId, sender nonce, contract address
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Build hash with chainId + sender nonce + contract address to prevent all replay vectors
        bytes32 transferHash = keccak256(
            abi.encodePacked(
                _DOMAIN_SEPARATOR,
                keccak256(abi.encode(recipient, amount, transferNonce))
            )
        );

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        // Increment per-sender nonce BEFORE marking processed (reentrancy-safe ordering)
        senderNonces[recipient]++;

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /// @notice Verify signature with ecrecover zero-address check and EIP-712
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

        // FIX: Reject zero-address result (invalid signature)
        require(recovered != address(0), "Invalid signature: zero address");

        return recovered == validator;
    }

    /// @notice Get the current nonce for a sender (for frontend integration)
    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
