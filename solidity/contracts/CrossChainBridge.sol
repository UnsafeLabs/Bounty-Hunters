// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    // Per-sender nonces to prevent same-chain replay
    mapping(address => uint256) public nonces;

    mapping(bytes32 => bool) public processedTransfers;

    // EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    // EIP-712 type hash for the transfer message
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)");

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        require(_bridgeToken != address(0), "Bridge token cannot be zero address");
        require(_validator != address(0), "Validator cannot be zero address");

        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        // Compute and store the EIP-712 domain separator
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonces[msg.sender]++);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Build the EIP-712 compliant hash: includes chainId and contract address
        // via DOMAIN_SEPARATOR, plus per-sender nonce
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                recipient,
                amount,
                transferNonce
            )
        );

        bytes32 transferHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                structHash
            )
        );

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

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

        // Explicit check for zero-address return from ecrecover
        require(recovered != address(0), "Invalid signature: recovered zero address");

        return recovered == validator;
    }

    /// @notice Returns the current nonce for a given sender
    /// @param sender The address to query the nonce for
    /// @return The current nonce for the sender
    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
