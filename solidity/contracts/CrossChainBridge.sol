// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CrossChainBridge {
    using ECDSA for bytes32;

    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedHashes;
    address public trustedSigner;

    event Locked(address indexed user, uint256 amount, bytes32 indexed txId);
    event Unlocked(address indexed user, uint256 amount, bytes32 indexed txId);

    constructor(address _trustedSigner) {
        require(_trustedSigner != address(0), "Invalid signer");
        trustedSigner = _trustedSigner;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            block.chainid,
            address(this)
        ));
    }

    function _hashUnlock(address user, uint256 amount, uint256 nonce, bytes32 txId) internal view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                keccak256("Unlock(address user,uint256 amount,uint256 nonce,bytes32 txId)"),
                user,
                amount,
                nonce,
                txId
            ))
        );
    }

    function lock(uint256 amount, bytes32 txId) external {
        require(msg.sender != address(0), "Invalid sender");
        require(amount > 0, "Invalid amount");
        require(txId != bytes32(0), "Invalid txId");

        nonces[msg.sender]++;

        emit Locked(msg.sender, amount, txId);
    }

    function unlock(
        address user,
        uint256 amount,
        uint256 nonce,
        bytes32 txId,
        bytes calldata signature
    ) external {
        require(user != address(0), "Invalid user");
        require(amount > 0, "Invalid amount");
        require(txId != bytes32(0), "Invalid txId");
        require(nonces[user] == nonce, "Invalid nonce");
        require(!processedHashes[txId], "Already processed");

        bytes32 hash = _hashUnlock(user, amount, nonce, txId);
        address recovered = hash.recover(signature);
        require(recovered == trustedSigner, "Invalid signature");
        require(recovered != address(0), "Signature from zero");

        nonces[user]++;
        processedHashes[txId] = true;

        emit Unlocked(user, amount, txId);
    }
}
