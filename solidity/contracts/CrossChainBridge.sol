// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    mapping(address => uint256) public nonces;

    mapping(bytes32 => bool) public processedTransfers;

    bytes32 public constant TRANSFER_TYPEHASH = keccak256("Transfer(address sender,address recipient,uint256 amount,uint256 nonce)");
    bytes32 public immutable EIP712_DOMAIN_HASH;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        EIP712_DOMAIN_HASH = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonces[msg.sender]);
        nonces[msg.sender]++;
    }

    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        bytes32 transferStructHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            sender,
            recipient,
            amount,
            transferNonce
        ));

        bytes32 transferHash = keccak256(abi.encodePacked("\x19\x01", EIP712_DOMAIN_HASH, transferStructHash));

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
            r := calldataload(add(signature.offset, 0))
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid v");

        address recovered = ecrecover(hash, v, r, s);
        require(recovered != address(0), "Invalid signature");
        return recovered == validator;
    }

    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
