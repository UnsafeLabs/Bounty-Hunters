// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;
 * @notice Facilitates token transfers between chains using validator signatures
 */
contract CrossChainBridge is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    // EIP-712 TypeHash for the transfer struct
    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address sender,address recipient,uint256 amount,uint256 nonce,uint256 chainId,address verifyingContract)"
    );

    // EIP-712 Domain TypeHash
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    // Contract name and version for EIP-712
    string public constant NAME = "CrossChainBridge";
    string public constant VERSION = "1";

    // EIP-712 domain separator (cached)
    bytes32 private immutable _domainSeparator;

    // Nonce tracking per sender to prevent same-chain replay
    mapping(address => uint256) private _nonces;

    // Token being bridged
    IERC20 public token;
    
    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    // BUG: No chain ID in hash — cross-chain replay possible
    // BUG: No nonce per sender — same-chain replay possible
    // BUG: No contract address in hash — replay after upgrade possible
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
        address _token,
        address _validator
    ) {
        // Compute and cache the EIP-712 domain separator
        _domainSeparator = _computeDomainSeparator();

        require(_token != address(0), "Invalid token address");
        require(_validator != address(0), "Invalid validator address");
        token = IERC20(_token);

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // BUG: Does not check for zero-address return from ecrecover
    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
     * @param amount Amount of tokens to transfer
     * @param signature Validator signature authorizing the transfer
     */
    function processTransfer( 
        address sender,
        address recipient,
        uint256 amount,
            v, r, s
        );

        // BUG: Missing require(recovered != address(0))
        return recovered == validator;
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        
        // Get and increment nonce for sender to prevent same-chain replay
        uint256 nonce = _nonces[sender]++;
        
        // Build EIP-712 typed data hash including chainId, nonce, and contract address
        bytes32 messageHash = _hashTypedDataV4(sender, recipient, amount, nonce);
        require(verifySignature(messageHash, signature), "Invalid signature");
        
        // Mark as processed to prevent replay
        
        emit TransferProcessed(sender, recipient, amount, block.chainid);
    }

    // Placeholder for missing closing brace if needed; original file had it.
    // The following functions are added/updated below.
    
    /**
     * @notice Verifies that a signature was signed by the validator
     * @param signature Signature to verify
     * @return True if signature is valid
     */
    function verifySignature(bytes32 digest, bytes memory signature) public view returns (bool) {
        // Use ECDSA library for safer signature verification
        address recoveredSigner = ECDSA.recover(digest, signature);
        
        // ECDSA.recover already reverts on invalid signatures, but we keep explicit check for clarity
        if (recoveredSigner == address(0)) {
            return false;
        }
        
        return recoveredSigner == validator;
    }
    
    /**
     * @notice Returns the next nonce for a given sender
     * @param sender Address to query
     * @return Next nonce value
     */
    function nonces(address sender) external view returns (uint256) {
        return _nonces[sender];
    }
    
    /**
     * @notice Computes the EIP-712 domain separator
     */
    function _computeDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                ke1ccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }
    
    /**
     * @notice Returns the cached domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }
    
    /**
     * @notice Hashes transfer data according to EIP-712
     */
    function _hashTypedDataV4(
        address sender,
        address recipient,
        uint256 amount,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                sender,
                recipient,
                amount,
                nonce,
                block.chainid,
                address(this)
            )
        );
        
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator,
                structHash
            )
        );
    }
    
    /**
        
        return (v, r, s);
    }
}
