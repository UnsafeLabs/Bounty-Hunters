// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public globalNonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonces;

    // EIP-712 domain separator
    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TRANSFER_TYPEHASH = keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)");
    bytes32 public DOMAIN_SEPARATOR;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, globalNonce++);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // EIP-712 typed data: chain ID + contract address + nonce all bound into the domain separator
        bytes32 transferHash = _hashTransfer(recipient, amount, transferNonce);
        bytes32 digest = _hashTypedData(transferHash);

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[digest] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
    }

    function _hashTransfer(address recipient, uint256 amount, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            nonce
        ));
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));
    }

    // Rebuild domain separator on upgrade — call this after proxy upgrade
    function refreshDomainSeparator() external {
        DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    // Expose domain separator for frontend integration
    function getDomainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
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

        // FIXED: Explicitly reject zero-address (invalid signature)
        require(recovered != address(0), "Invalid signature: zero-address");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
