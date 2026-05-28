// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "BridgeTransfer(address recipient,uint256 amount,uint256 nonce,uint256 chainId,address verifyingContract)"
    );
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public outboundNonces;
    mapping(address => uint256) public nonces;

    event TransferInitiated(
        address indexed sender,
        uint256 amount,
        uint256 targetChain,
        uint256 nonce
    );
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        require(_bridgeToken != address(0), "Invalid token");
        require(_validator != address(0), "Invalid validator");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        uint256 senderNonce = outboundNonces[msg.sender];
        outboundNonces[msg.sender] = senderNonce + 1;
        nonce++;
        require(
            bridgeToken.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonce);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function transferStructHash(
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public view returns (bytes32) {
        return keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));
    }

    function hashTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator(),
            transferStructHash(recipient, amount, transferNonce)
        ));
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(transferNonce == nonces[recipient], "Invalid nonce");

        bytes32 transferHash = hashTransfer(recipient, amount, transferNonce);
        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        nonces[recipient] = transferNonce + 1;
        require(bridgeToken.transfer(recipient, amount), "Token transfer failed");

        emit TransferProcessed(transferHash, recipient, amount);
    }

    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
        return recoverSigner(hash, signature) == validator;
    }

    function recoverSigner(bytes32 hash, bytes calldata signature) public pure returns (address) {
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
        if (v != 27 && v != 28) {
            return address(0);
        }
        if (uint256(s) > SECP256K1_HALF_ORDER) {
            return address(0);
        }

        address recovered = ecrecover(hash, v, r, s);
        if (recovered == address(0)) {
            return address(0);
        }
        return recovered;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
