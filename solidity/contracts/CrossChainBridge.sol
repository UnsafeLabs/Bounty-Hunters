// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonces;

    string public constant DOMAIN_NAME = "CrossChainBridge";
    string public constant DOMAIN_VERSION = "1";
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address recipient,uint256 amount,uint256 transferNonce,address sender,uint256 senderNonce)");

    bytes32 private _cachedDomainSeparator;
    uint256 private _cachedChainId;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    function domainSeparator() public view returns (bytes32) {
        if (block.chainid == _cachedChainId) {
            return _cachedDomainSeparator;
        }
        return _buildDomainSeparator();
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        address sender,
        uint256 senderNonce,
        bytes calldata signature
    ) external {
        require(senderNonce == senderNonces[sender], "Invalid sender nonce");
        senderNonces[sender] = senderNonce + 1;

        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            sender,
            senderNonce
        ));

        bytes32 typedDataHash = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator(),
            structHash
        ));

        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            sender,
            senderNonce,
            block.chainid,
            address(this)
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(typedDataHash, signature), "Invalid signature");

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
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)),
            v, r, s
        );

        require(recovered != address(0), "Invalid signature: zero address");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes(DOMAIN_NAME)),
            keccak256(bytes(DOMAIN_VERSION)),
            block.chainid,
            address(this)
        ));
    }
}
