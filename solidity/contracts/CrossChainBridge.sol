// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    
    // Per-sender nonce to prevent same-chain replay
    mapping(address => uint256) public senderNonce;
    
    // Track processed transfers
    mapping(bytes32 => bool) public processedTransfers;
    
    // EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;
    
    // EIP-712 type hashes
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce,uint256 chainId,address contractAddress)"
    );

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        
        // Construct EIP-712 domain separator
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        
        uint256 currentNonce = senderNonce[msg.sender];
        senderNonce[msg.sender]++;
        
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, currentNonce);
    }

    // FIXED: Added chain ID, nonce per sender, contract address to prevent replay attacks
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Create EIP-712 compliant hash with replay protection
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(this)
        ));
        
        bytes32 transferHash = keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            structHash
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // FIXED: Added zero-address check and EIP-712 verification
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
        
        // FIX: Reject zero-address (invalid signature)
        require(recovered != address(0), "Invalid signature: zero address");

        return recovered == validator;
    }
    
    // Get current nonce for a sender (frontend integration)
    function getNonce(address sender) external view returns (uint256) {
        return senderNonce[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}