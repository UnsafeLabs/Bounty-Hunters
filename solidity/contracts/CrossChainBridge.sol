// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonce;

    bytes32 private immutable DOMAIN_SEPARATOR;
    bytes32 private constant EIP712_TYPEHASH = keccak256(
        "ProcessTransfer(address recipient,uint256 amount,uint256 nonce,uint256 chainId,address contractAddress)"
    );

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        uint256 currentNonce = senderNonce[msg.sender]++;
        emit TransferInitiated(msg.sender, amount, targetChain, currentNonce);
    }

    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonce[sender];
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        require(recipient != address(0), "Invalid recipient");

        bytes32 structHash = keccak256(abi.encode(
            EIP712_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[digest] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    function verifySignature(bytes32 digest, bytes calldata signature) public pure returns (bool) {
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
        require(v == 27 || v == 28, "Invalid v value");

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "Invalid signature: zero address recovered");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }
}
