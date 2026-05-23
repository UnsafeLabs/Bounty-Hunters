// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CrossChainBridge is ReentrancyGuard {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public globalNonce;

    mapping(address => uint256) public senderNonces;
    mapping(bytes32 => bool) public processedTransfers;

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
        uint256 sourceChainId,
        bytes calldata signature
    ) external nonReentrant {
        // Include chainid, contract address, and sender nonce in hash to prevent replay
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            sourceChainId,
            block.chainid,
            address(this)
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
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

        address recovered = ecrecover(
            keccak256(abi.encodePacked("\\x19Ethereum Signed Message:\\n32", hash)),
            v, r, s
        );

        // Check for zero-address return (invalid signature)
        require(recovered != address(0), "Invalid signature: zero address");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
