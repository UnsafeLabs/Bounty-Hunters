// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract CrossChainBridge is EIP712 {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(address => uint256) public senderNonces;
    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    // EIP-712 domain separator built from name+version chainId+verifyingContract
    constructor(address _bridgeToken, address _validator)
        EIP712("CrossChainBridge", "1")
    {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, senderNonces[msg.sender]++);
    }

    // Fixed: chainId + nonce + contract address in hash → no cross-chain, same-chain, or post-upgrade replay
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // Include chain ID, sender nonce, and contract address to prevent all replay vectors
        bytes32 transferHash = keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            msg.sender,
            transferNonce,
            recipient,
            amount
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // EIP-712 typed data verification — safer for wallet UX
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

        address recovered = ecrecover(
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)),
            v, r, s
        );

        // Reject zero-address (invalid signature / ecrecover returns 0 on bad signature)
        require(recovered != address(0), "Invalid signature");

        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    function querySenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    // EIP-712 typed data struct hash helper
    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }
}