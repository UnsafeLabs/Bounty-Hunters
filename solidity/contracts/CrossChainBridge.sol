// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    // EIP-712 domain separator
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce)"
    );

    bytes32 public domainSeparator;
    string public constant NAME = "CrossChainBridge";
    string public constant VERSION = "1";

    // Per-sender nonce to prevent same-chain replay
    mapping(address => uint256) public senderNonces;

    // Combined hash includes chain ID + contract address → prevents cross-chain & post-upgrade replay
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonces[msg.sender]++);
    }

    // EIP-712 structured message hash: chainId + contract + nonce → prevents all replay types
    function _buildTransferHash(address recipient, uint256 amount, uint256 senderNonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                recipient,
                amount,
                senderNonce
            )
        );
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                structHash
            )
        );
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        bytes calldata signature
    ) external {
        uint256 senderNonce = senderNonces[recipient];

        bytes32 transferHash = _buildTransferHash(recipient, amount, senderNonce);

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        senderNonces[recipient] = senderNonce + 1;

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // EIP-712 typed data signing with ecrecover zero-address check
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

        // Reject zero-address from ecrecover (invalid signature)
        require(recovered != address(0), "Invalid signature: zero address");

        return recovered == validator;
    }

    // Query per-sender nonce for frontend integration
    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
