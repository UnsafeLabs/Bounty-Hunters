// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title CrossChainBridge
/// @notice Validator-signed bridge with replay protection.
/// @dev The signed payload is EIP-712 typed data, so the digest is bound to the
/// chain id and to this contract address. A signature is therefore unusable on
/// another chain and unusable against a redeployed/upgraded bridge. A per-sender
/// nonce closes same-chain replay.
contract CrossChainBridge is EIP712 {
    using SafeERC20 for IERC20;

    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    /// @notice Next nonce expected from each source-chain sender.
    mapping(address => uint256) public nonces;

    mapping(bytes32 => bool) public processedTransfers;

    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address sender,address recipient,uint256 amount,uint256 nonce)");

    event TransferInitiated(address indexed sender, uint256 amount, uint256 targetChain, uint256 nonce);
    event TransferProcessed(bytes32 indexed digest, address indexed sender, address indexed recipient, uint256 amount, uint256 nonce);

    error ZeroAmount();
    error ZeroAddress();
    error InvalidNonce(uint256 expected, uint256 provided);
    error AlreadyProcessed();
    error InvalidSignature();
    error NotValidator();

    constructor(address _bridgeToken, address _validator) EIP712("CrossChainBridge", "1") {
        if (_bridgeToken == address(0) || _validator == address(0)) revert ZeroAddress();
        bridgeToken = IERC20(_bridgeToken);
        validator = _validator;
    }

    function initiateTransfer(uint256 amount, uint256 targetChain) external {
        if (amount == 0) revert ZeroAmount();
        bridgeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TransferInitiated(msg.sender, amount, targetChain, nonce++);
    }

    /// @notice Settle a validator-signed transfer.
    /// @param sender Source-chain account whose nonce is consumed.
    function processTransfer(
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        bytes calldata signature
    ) external {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0) || sender == address(0)) revert ZeroAddress();

        uint256 expected = nonces[sender];
        if (transferNonce != expected) revert InvalidNonce(expected, transferNonce);

        bytes32 digest = hashTransfer(sender, recipient, amount, transferNonce);
        if (processedTransfers[digest]) revert AlreadyProcessed();

        // ECDSA.recover reverts on malformed input, on the zero-address result and
        // on high-s malleability, so a bad signature can never be accepted.
        if (ECDSA.recover(digest, signature) != validator) revert InvalidSignature();

        processedTransfers[digest] = true;
        nonces[sender] = expected + 1;

        bridgeToken.safeTransfer(recipient, amount);
        emit TransferProcessed(digest, sender, recipient, amount, transferNonce);
    }

    /// @notice EIP-712 digest for a transfer, bound to chain id and this contract.
    function hashTransfer(address sender, address recipient, uint256 amount, uint256 transferNonce)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(TRANSFER_TYPEHASH, sender, recipient, amount, transferNonce))
        );
    }

    /// @notice Domain separator, exposed for off-chain signers and tests.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }
}
