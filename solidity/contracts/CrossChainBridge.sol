// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    // EIP-712 domain separator
    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address verifyingContract)"
    );

    mapping(address => uint256) public senderNonces; // per-sender nonce
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        _buildDomainSeparator();
    }

    function _buildDomainSeparator() internal {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    /// @notice Initiate a cross-chain transfer (locks tokens in bridge)
    /// @param amount Amount of tokens to bridge
    /// @param targetChain Target chain ID
    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    /// @notice Process a cross-chain transfer with replay protection
    /// @param recipient Destination address on this chain
    /// @param amount Amount of tokens to release
    /// @param transferNonce Unique nonce per sender for same-chain replay prevention
    /// @param sender Address of the sender on the source chain
    /// @param signature Validator signature over the EIP-712 typed data
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        address sender,
        bytes calldata signature
    ) external {
        // EIP-712 typed data hash
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));

        bytes32 transferHash = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /// @notice Verify EIP-712 signature from the validator
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
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)),
            v, r, s
        );

        // Prevent invalid signature recovery (zero address means recovery failed)
        require(recovered != address(0), "Invalid signature");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
