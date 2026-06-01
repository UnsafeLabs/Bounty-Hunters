// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

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
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    // FIX: Include block.chainid, address(this), and sender nonce in hash
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        // FIX: Cross-chain replay protection via chainid
        bytes32 transferHash = keccak256(abi.encodePacked(
            block.chainid,    // FIX: prevent cross-chain replay
            address(this),    // FIX: prevent replay after proxy upgrade
            recipient,
            amount,
            transferNonce,
            senderNonces[msg.sender]++  // FIX: prevent same-chain replay
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    // FIX: Check for zero-address return from ecrecover
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

        // FIX: Require non-zero address (invalid signature check)
        require(recovered != address(0), "Invalid signature");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}