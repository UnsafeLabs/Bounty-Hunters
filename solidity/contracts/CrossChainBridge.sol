// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;

    string private constant _EIP712_DOMAIN_TYPE_HASH = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
    string private constant _TRANSFER_TYPE_HASH = "Transfer(address recipient,uint256 amount,uint256 nonce)";
    bytes32 private _domainSeparator;
    mapping(address => uint256) public nonces;

    mapping(bytes32 => bool) public processedTransfers;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        _domainSeparator = keccak256(abi.encode(
            keccak256(bytes(_EIP712_DOMAIN_TYPE_HASH)),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonces[msg.sender]++);
    }

    // BUG: No chain ID in hash — cross-chain replay possible
    // BUG: No nonce per sender — same-chain replay possible
    // BUG: No contract address in hash — replay after upgrade possible
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external {
        bytes32 transferHash = keccak256(abi.encode(
            keccak256(bytes(_TRANSFER_TYPE_HASH)),
            recipient,
            amount,
            nonce
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator, transferHash));

        require(!processedTransfers[digest], "Already processed");
        require(verifySignature(digest, signature), "Invalid signature");
        require(nonce == nonces[recipient], "Invalid nonce");

        processedTransfers[digest] = true;
        nonces[recipient]++;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(digest, recipient, amount);
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

        address recovered = ecrecover(hash, v, r, s);

        require(recovered != address(0), "Invalid signature");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    function getNonces(address user) external view returns (uint256) {
        return nonces[user];
    }
}
