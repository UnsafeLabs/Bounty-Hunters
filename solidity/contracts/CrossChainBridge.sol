// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    string public constant EIP712_NAME = "CrossChainBridge";
    string public constant EIP712_VERSION = "1";

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("BridgeTransfer(address recipient,uint256 amount,uint256 nonce)");

    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public nonces;

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        require(_bridgeToken != address(0), "Invalid token");
        require(_validator != address(0), "Invalid validator");
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        require(bridgeToken.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes(EIP712_NAME)),
            keccak256(bytes(EIP712_VERSION)),
            block.chainid,
            address(this)
        ));
    }

    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }

    function getTransferHash(
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce
        ));

        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(transferNonce == nonces[recipient], "Invalid nonce");

        bytes32 transferHash = getTransferHash(recipient, amount, transferNonce);

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(transferHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        nonces[recipient] = transferNonce + 1;
        require(bridgeToken.transfer(recipient, amount), "Token transfer failed");

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
        require(v == 27 || v == 28, "Invalid signature v");

        address recovered = ecrecover(hash, v, r, s);

        require(recovered != address(0), "Invalid signature recovery");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
