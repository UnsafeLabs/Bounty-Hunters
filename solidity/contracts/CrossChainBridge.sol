// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(bytes32 => bool) public processedTransfers;
    mapping(address => uint256) public senderNonces;

    bytes32 private immutable DOMAIN_SEPARATOR;

    bytes32 private constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 senderNonce)"
    );

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed transferHash, address indexed recipient, uint256 amount);

    constructor(address _bridgeToken, address _validator) {
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        require(amount > 0, "Amount must be > 0");
        bridgeToken.transferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 senderNonce_,
        bytes calldata signature
    ) external {
        // Hash includes chain ID, contract address, sender's nonce, and EIP-712 domain separator
        bytes32 transferHash = keccak256(abi.encodePacked(
            block.chainid,
            address(this),
            recipient,
            amount,
            senderNonce_,
            msg.sender
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(recipient, amount, senderNonce_, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        senderNonces[msg.sender] = senderNonce_ + 1;

        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    function verifySignature(
        address recipient,
        uint256 amount,
        uint256 senderNonce_,
        bytes calldata signature
    ) public view returns (bool) {
        return _verifyEIP712Signature(recipient, amount, senderNonce_, signature);
    }

    function _verifyEIP712Signature(
        address recipient,
        uint256 amount,
        uint256 senderNonce_,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_TYPEHASH, recipient, amount, senderNonce_)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        return _recoverSigner(digest, signature) == validator;
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
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
        require(v == 27 || v == 28, "Invalid v value");

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "Invalid signature");

        return recovered;
    }

    function getSenderNonce(address sender) external view returns (uint256) {
        return senderNonces[sender];
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
