// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Cross-chain bridge with EIP-712 typed signing bound to chainId +
/// verifyingContract, per-sender nonces, and zero-address ecrecover rejection.
contract CrossChainBridge {
    string public constant NAME = "CrossChainBridge";
    string public constant VERSION = "1";

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("BridgeTransfer(address sender,address recipient,uint256 amount,uint256 nonce)");

    IERC20 public bridgeToken;
    address public validator;

    /// @dev Per-sender nonce for inbound processTransfer (queryable for frontends).
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedTransfers;

    /// @dev Outbound initiateTransfer counter (legacy global nonce retained for events).
    uint256 public outboundNonce;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(
        bytes32 indexed transferHash,
        address indexed sender,
        address indexed recipient,
        uint256 amount
    );

    constructor(address _bridgeToken, address _validator) {
        require(_bridgeToken != address(0), "Invalid token");
        require(_validator != address(0), "Invalid validator");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    /// @notice EIP-712 domain separator (name, version, chainId, verifyingContract).
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        uint256 n = outboundNonce++;
        require(bridgeToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit TransferInitiated(msg.sender, amount, targetChain, n);
    }

    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        require(sender != address(0), "Invalid sender");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(transferNonce == nonces[sender], "Invalid nonce");

        bytes32 transferHash = hashTransfer(sender, recipient, amount, transferNonce);

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        nonces[sender] = transferNonce + 1;
        require(bridgeToken.transfer(recipient, amount), "Transfer failed");

        emit TransferProcessed(transferHash, sender, recipient, amount);
    }

    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    function hashTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_TYPEHASH, sender, recipient, amount, transferNonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    /// @notice Recover validator from an EIP-712 digest; reject zero-address ecrecover.
    function verifySignature(bytes32 digest, bytes calldata signature) public view returns (bool) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            return false;
        }

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "Invalid signer");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
