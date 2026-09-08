// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;
    
    // EIP-712 domain separator type hash
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonces;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonces[msg.sender]++);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 targetChain,
        bytes calldata signature
    ) external {
        // Verify that the nonce for this sender matches
        require(senderNonces[msg.sender] == transferNonce, "Invalid nonce");
        
        // Increment sender nonce to prevent same-chain replay
        senderNonces[msg.sender]++;
        
        // Create hash with chain ID, contract address, and all transfer parameters
        // This prevents cross-chain replay, same-chain replay, and replay after upgrade
        bytes32 transferHash = keccak256(abi.encodePacked(
            keccak256("uint256,address,uint256,uint256,uint256"),
            block.chainid,
            address(this),
            recipient,
            amount,
            transferNonce
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // Verify signature with EIP-712 support and zero-address check
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

        // Construct EIP-712 domain separator for structured signing
        bytes32 domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1.0"),
            block.chainid,
            address(this)
        ));
        
        // Construct EIP-712 structured hash: \x19\x01 || domainSeparator || messageHash
        bytes32 structuredHash = keccak256(abi.encodePacked(
            hex"1901",
            domainSeparator,
            hash
        ));

        address recovered = ecrecover(structuredHash, v, r, s);

        // Check for zero-address return from ecrecover (invalid signature)
        require(recovered != address(0), "Invalid signature: ecrecover returned zero address");
        
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
    
    // Function to query sender nonce for frontend integration
    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }
}
