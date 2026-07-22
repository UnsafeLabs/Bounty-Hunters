// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CrossChainBridge is EIP712 {
    using ECDSA for bytes32;

    address public validator;
    mapping(address => uint256) public nonces;

    event TransferProcessed(address indexed sender, address indexed recipient, uint256 amount, uint256 nonce);

    constructor(address _validator) EIP712("CrossChainBridge", "1") {
        validator = _validator;
    }

    struct Transfer {
        address sender;
        address recipient;
        uint256 amount;
        uint256 nonce;
    }

    bytes32 private constant TRANSFER_TYPEHASH = keccak256("Transfer(address sender,address recipient,uint256 amount,uint256 nonce)");

    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(sender != address(0), "Invalid sender");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(nonce == nonces[sender], "Invalid nonce");
        require(_verifySignature(sender, recipient, amount, nonce, signature), "Invalid signature");

        // Mark nonce as used
        nonces[sender]++;

        emit TransferProcessed(sender, recipient, amount, nonce);

        // Transfer logic (e.g., mint tokens) would go here
    }

    function _verifySignature(
        address sender,
        address recipient,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TRANSFER_TYPEHASH,
                    sender,
                    recipient,
                    amount,
                    nonce
                )
            )
        );
        address recovered = ECDSA.recover(digest, signature);
        return recovered == validator && recovered != address(0);
    }

    // Expose domain separator for frontend
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}