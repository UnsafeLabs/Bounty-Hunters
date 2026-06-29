// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;
 * @dev Facilitates token transfers between chains using validator signatures
 */
contract CrossChainBridge is ReentrancyGuard, Ownable {
    using ECDSA for bytes32;

    // Transfer request struct for EIP-712
    struct TransferRequest {
        address token;
        address recipient;
    constructor(address _bridgeToken, address _validator) {
        uint256 sourceChainId;
    }

    // EIP-712 type hashes
    bytes32 private constant TRANSFER_REQUEST_TYPEHASH = keccak256(
        "TransferRequest(address token,address recipient,uint256 amount,uint256 sourceChainId,uint256 nonce,uint256 targetChainId,address targetContract)"
    );

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 private immutable _domainSeparator;
    address public validator;
    bool public paused;
    
        bridgeToken.transferFrom(msg.sender, address(this), amount);
    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => bool) public supportedTokens;
    
    // Nonce tracking per sender for replay protection
    mapping(address => uint256) public nonces;
    
    // Track used signatures to prevent replay
    mapping(bytes32 => bool) public usedSignatures;
    
    event TransferInitiated(
        bytes32 indexed transferId,
        address indexed token,
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        bytes signature,
        uint256 nonce,
        address sender
    );
    
    event ValidatorUpdated(address indexed oldValidator, address indexed newValidator);
        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);
    error InvalidSignature();
    error TransferAlreadyProcessed();
    error TokenNotSupported();
    error InvalidValidatorSignature();
    
    modifier whenNotPaused() {
        require(!paused, "Bridge is paused");
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;
        _;
    }
    
    constructor(address _validator, string memory name, string memory version) {
        _domainSeparator = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes(name)),
            keccak256(bytes(version)),
            block.chainid,
            address(this)
        ));
        
        validator = _validator;
    }
    
        if (v < 27) v += 27;
     * @notice Initiates a transfer from this chain to another
     */
    function initiateTransfer(address token, address recipient, uint256 amount, uint256 targetChainId) external whenNotPaused {
        // Increment nonce for sender
        require(supportedTokens[token], "Token not supported");
        require(amount > 0, "Amount must be greater than 0");
        
        // BUG: Missing require(recovered != address(0))
        return recovered == validator;
    }
            recipient: recipient,
            amount: amount,
            sourceChainId: block.chainid,
            targetChainId: targetChainId,
            nonce: nonces[msg.sender]++,
            sender: msg.sender
        });
        
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        bytes calldata signature,
        uint256 nonce,
        address sender
    ) external nonReentrant whenNotPaused {
        require(targetChainId == block.chainid, "Invalid target chain");
        require(supportedTokens[token], "Token not supported");
            recipient: recipient,
            amount: amount,
            sourceChainId: sourceChainId,
            targetChainId: targetChainId,
            nonce: nonce,
            sender: sender
        });
        
        require(!processedTransfers[transferId], "Transfer already processed");
            amount,
            sourceChainId,
            targetChainId,
            signature,
            nonce,
            sender
        );
    }
    
        address recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        uint256 nonce,
        address sender
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            token,
            amount,
            sourceChainId,
            targetChainId,
            block.chainid,
            nonce,
            sender,
            address(this)
        ));
    }
    
        address recipient,
        uint256 amount,
        uint256 sourceChainId,
        uint256 targetChainId,
        uint256 nonce,
        address sender
    ) internal view returns (bool) {
        bytes32 messageHash = keccak256(abi.encode(
            TRANSFER_REQUEST_TYPEHASH,
            recipient,
            amount,
            sourceChainId,
            targetChainId,
            nonce,
            block.chainid,
            address(this)
        ));
        
        bytes32 typedDataHash = keccak256(abi.encodePacked(
        ));
        
        address recovered = ECDSA.recover(typedDataHash, signature);
        
        // Explicitly reject zero-address return from ecrecover
        if (recovered == address(0)) {
            revert InvalidValidatorSignature();
        }
        
        return recovered == validator;
    }
    
        return validator;
    }
    
    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }
    
    function updateValidator(address newValidator) external onlyOwner {
        address oldValidator = validator;
        validator = newValidator;
