// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    // EIP-712 domain separator
    bytes32 private constant DOMAIN_TYPE_HASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant TRANSFER_TYPE_HASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce)"
    );

    string private constant NAME = "CrossChainBridge";
    string private constant VERSION = "1";

    bytes32 public DOMAIN_SEPARATOR;

    // Nonce per sender to prevent same-chain replay
    mapping(address => uint256) public senderNonce;

    // Track processed transfer hashes (additional safety)
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPE_HASH,
            keccak256(bytes(NAME)),
            keccak256(bytes(VERSION)),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonce[msg.sender]++);
    }

    /// @notice Process a transfer with EIP-712 typed signature
    /// @dev Includes chain ID, nonce, and contract address in signed data
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Build the EIP-712 typed struct hash
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPE_HASH,
            recipient,
            amount,
            transferNonce
        ));

        // Build the full EIP-712 digest (includes chain ID and contract address)
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));

        // Use sender's nonce to prevent same-chain replay
        require(transferNonce == senderNonce[recipient], "Invalid nonce");

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[digest] = true;
        senderNonce[recipient]++;

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    /// @notice Verify an EIP-712 typed signature
    /// @dev Checks for zero-address return from ecrecover (invalid signature)
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

        // FIX: Reject zero-address from ecrecover (invalid signature)
        require(recovered != address(0), "Invalid signature: zero address");

        return recovered == validator;
    }

    /// @notice Get the current nonce for a recipient (frontend integration)
    function getNonce(address account) external view returns (uint256) {
        return senderNonce[account];
    }

    /// @notice Get the pool balance
    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
