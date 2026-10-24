// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title CrossChainBridge
/// @notice Validator-authorized token transfers with chain, contract, and nonce domain separation.
contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(address => uint256) public nonces;
    mapping(address => uint256) public outboundNonces;
    mapping(bytes32 => bool) public processedTransfers;

    string public constant DOMAIN_NAME = "CrossChainBridge";
    string public constant DOMAIN_VERSION = "1";
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address sender,address recipient,uint256 amount,uint256 nonce)"
    );
    uint256 private constant SECP256K1N_HALF =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        require(_bridgeToken != address(0), "Token is zero address");
        require(_validator != address(0), "Validator is zero address");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        uint256 transferNonce = outboundNonces[msg.sender]++;
        nonce++;
        require(bridgeToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        emit TransferInitiated(msg.sender, amount, targetChain, transferNonce);
    }

    /// @notice Process a validator-signed transfer. The nonce is scoped to the source sender.
    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        require(sender != address(0), "Sender is zero address");
        require(recipient != address(0), "Recipient is zero address");
        require(transferNonce == nonces[sender], "Invalid nonce");

        bytes32 transferHash = getTransferDigest(sender, recipient, amount, transferNonce);
        require(!processedTransfers[transferHash], "Already processed");
        require(verifyTransferSignature(sender, recipient, amount, transferNonce, signature), "Invalid signature");

        // Effects precede the token call so a malicious ERC20 cannot re-enter with the same nonce.
        nonces[sender] = transferNonce + 1;
        processedTransfers[transferHash] = true;
        require(bridgeToken.transfer(recipient, amount), "Transfer failed");

        emit TransferProcessed(transferHash, recipient, amount);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function getTransferStructHash(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(TRANSFER_TYPEHASH, sender, recipient, amount, transferNonce));
    }

    function getTransferDigest(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                getTransferStructHash(sender, recipient, amount, transferNonce)
            )
        );
    }

    function verifyTransferSignature(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) public view returns (bool) {
        return _recover(getTransferDigest(sender, recipient, amount, transferNonce), signature) == validator;
    }

    /// @dev Retained for callers that verify an older personal-sign digest. New transfers use EIP-712.
    function verifySignature(bytes32 hash, bytes calldata signature) public view returns (bool) {
        bytes32 personalDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        return _recover(personalDigest, signature) == validator;
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address recovered) {
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
        require(v == 27 || v == 28, "Invalid signature v");
        require(uint256(s) <= SECP256K1N_HALF, "Invalid signature s");
        recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "Invalid signature");
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
