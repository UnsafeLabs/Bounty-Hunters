// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract CrossChainBridge is EIP712 {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonces;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    // EIP-712 type hash
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address sender,address recipient,uint256 amount,uint256 targetChain,uint256 nonce,uint256 chainId)"
    );

    struct Transfer {
        address sender;
        address recipient;
        uint256 amount;
        uint256 targetChain;
        uint256 nonce;
        uint256 chainId;
    }

    constructor(address _bridgeToken, address _validator)
        EIP712("CrossChainBridge", "1")
    {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 targetChain,
        bytes calldata signature
    ) external {
        require(recipient != address(0), "Invalid recipient");

        // Increment sender nonce to prevent same-chain replay
        uint256 currentNonce = ++senderNonces[msg.sender];

        Transfer memory transfer = Transfer({
            sender: msg.sender,
            recipient: recipient,
            amount: amount,
            targetChain: targetChain,
            nonce: currentNonce,
            chainId: block.chainid
        });

        bytes32 transferHash = _hashTypedDataV4(
            keccak256(abi.encode(
                TRANSFER_TYPEHASH,
                transfer.sender,
                transfer.recipient,
                transfer.amount,
                transfer.targetChain,
                transfer.nonce,
                transfer.chainId
            ))
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

        address recovered = ecrecover(
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)),
            v, r, s
        );

        // Reject zero-address from invalid signatures
        require(recovered != address(0), "Invalid signature");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
