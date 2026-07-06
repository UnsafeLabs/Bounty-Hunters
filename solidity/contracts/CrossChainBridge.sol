// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonce;

    // EIP-712 domain separator
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 chainId,address contractAddress)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;
    string private constant NAME = "CrossChainBridge";
    string private constant VERSION = "1";

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes(NAME)),
            keccak256(bytes(VERSION)),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        uint256 nonce = senderNonce[msg.sender]++;
        emit TransferInitiated(msg.sender, amount, targetChain, nonce);
    }

    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        bytes calldata signature
    ) external {
        uint256 nonce = senderNonce[sender];
        bytes32 transferHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            sender,
            recipient,
            amount,
            nonce,
            block.chainid,
            address(this)
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            transferHash
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        senderNonce[sender] = nonce + 1;
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
        require(recovered != address(0), "Invalid signature");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
