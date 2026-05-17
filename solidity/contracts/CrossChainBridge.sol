// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public globalNonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonce;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce)"
    );

    string public constant NAME = "CrossChainBridge";
    string public constant VERSION = "1";

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function getDomainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes(NAME)),
            keccak256(bytes(VERSION)),
            block.chainid,
            address(this)
        ));
    }

    function getTransferHash(address recipient, uint256 amount, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            getDomainSeparator(),
            keccak256(abi.encode(
                TRANSFER_TYPEHASH,
                recipient,
                amount,
                nonce
            ))
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        uint256 currentNonce = globalNonce++;
        emit TransferInitiated(msg.sender, amount, targetChain, currentNonce);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Build hash with chainId, contract address, and sender nonce to prevent replays
        uint256 senderN = senderNonce[recipient];

        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        senderNonce[recipient] = senderN + 1;
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

        require(recovered != address(0), "Invalid ecrecover result");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonce[sender];
    }
}