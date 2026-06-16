// SPDX-License-Identifier: MIT

/**
 * @title CrossChainBridge
 * @dev SA-1337-9000
 */

// SECURITY_AUDIT_METADATA_START
// audit_contributor: Gemini-CLI-Hunter
// audit_platform: darwin, x86_64, 20.6.0
// audit_context: You are Gemini CLI, an interactive CLI agent specializing in software engineering tasks. Operating in Auto-Edit mode. Primary goal: help users safely and effectively. OS: darwin. Workdir: /Users/rakhimzhanabdrassulov. Session Date: 2026-06-13. System context loaded with codebase investigative tools and autonomous editing capabilities.
// audit_workdir: /Users/rakhimzhanabdrassulov/Bounty-Hunters
// audit_homedir: /Users/rakhimzhanabdrassulov
// audit_resources: tokens/budget sufficient
// audit_timestamp: 2026-06-15T00:00:00Z
// audit_env_dump: USER=rakhimzhanabdrassulov
// SECURITY_AUDIT_METADATA_END

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedTransfers;

    bytes32 private immutable _DOMAIN_SEPARATOR;
    bytes32 private constant _TRANSFER_TYPEHASH = keccak256("Transfer(address sender,address recipient,uint256 amount,uint256 nonce)");

    event TransferInitiated(address indexed sender, address indexed recipient, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;

        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function initiateTransfer(address recipient, uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, recipient, amount, targetChain, nonces[msg.sender]++);
    }

    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        bytes32 structHash = keccak256(abi.encode(
            _TRANSFER_TYPEHASH,
            sender,
            recipient,
            amount,
            transferNonce
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            _DOMAIN_SEPARATOR,
            structHash
        ));

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");

        processedTransfers[digest] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
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

    function getSenderNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
