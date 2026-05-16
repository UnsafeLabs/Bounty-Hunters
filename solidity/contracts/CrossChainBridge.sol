// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    string public constant NAME = "CrossChainBridge";
    string public constant VERSION = "1";

    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "BridgeTransfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 chainId,address bridge)"
    );

    IERC20 public bridgeToken;
    address public validator;
    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedTransfers;

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
        uint256 transferNonce = nonces[msg.sender]++;
        require(bridgeToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit TransferInitiated(msg.sender, amount, targetChain, transferNonce);
    }

    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        require(transferNonce == nonces[sender], "Invalid nonce");

        bytes32 structHash = hashTransfer(sender, recipient, amount, transferNonce);
        bytes32 transferHash = toTypedDataHash(structHash);

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        nonces[sender] = transferNonce + 1;
        require(bridgeToken.transfer(recipient, amount), "Transfer failed");

        emit TransferProcessed(transferHash, recipient, amount);
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
        return keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            sender,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));
    }

    function toTypedDataHash(bytes32 structHash) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

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

        if (v < 27) v += 27;
        if (v != 27 && v != 28) return false;

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) return false;

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
