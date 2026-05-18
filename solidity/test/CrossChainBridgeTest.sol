solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CrossChainBridge
/// @notice Facilitates token transfers between chains with full replay protection (EIP‑712, nonce, chain ID, contract address)
contract CrossChainBridge {
    // ----------------------------------------------------------------------- //
    //  Custom Errors
    // ----------------------------------------------------------------------- //
    error CrossChainBridge__InvalidSignature();
    error CrossChainBridge__InvalidNonce();
    error CrossChainBridge__InsufficientBalance();
    error CrossChainBridge__TransferFailed();
    error CrossChainBridge__ZeroAddress();
    error CrossChainBridge__AlreadyValidator();
    error CrossChainBridge__NotValidator();
    error CrossChainBridge__Unauthorised();
    error CrossChainBridge__HighS();

    // ----------------------------------------------------------------------- //
    //  Events
    // ----------------------------------------------------------------------- //
    event TransferProcessed(address indexed sender, address indexed to, uint256 amount, uint256 nonce);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event VersionUpdated(string newVersion);

    // ----------------------------------------------------------------------- //
    //  EIP‑712 Type Hash
    // ----------------------------------------------------------------------- //
    bytes32 private constant TRANSFER_TYPEHASH = keccak256("Transfer(address sender,address to,uint256 amount,uint256 nonce)");
    bytes32 private immutable _DOMAIN_SEPARATOR;
    bytes32 private immutable _TYPE_HASH_EIP712 = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // ----------------------------------------------------------------------- //
    //  State
    // ----------------------------------------------------------------------- //
    string public name;
    string public version;
    mapping(address => bool) public validators;
    mapping(address => uint256) public nonces;
    address private _owner;

    // ----------------------------------------------------------------------- //
    //  Modifiers
    // ----------------------------------------------------------------------- //
    modifier onlyOwner() {
        if (msg.sender != _owner) revert CrossChainBridge__Unauthorised();
        _;
    }
    modifier onlyValidator() {
        if (!validators[msg.sender]) revert CrossChainBridge__NotValidator();
        _;
    }

    // ----------------------------------------------------------------------- //
    //  Constructor
    // ----------------------------------------------------------------------- //
    constructor() {
        _owner = msg.sender;
        name = "CrossChainBridge";
        version = "1";
        _DOMAIN_SEPARATOR = _buildDomainSeparator(name, version, block.chainid, address(this));
    }

    /// @notice Recalculates and stores the domain separator (idempotent).
    /// @dev Called externally only when name, version, or chainId changes.
    function _buildDomainSeparator(
        string memory _name,
        string memory _version,
        uint256 _chainId,
        address _verifyingContract
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _TYPE_HASH_EIP712,
                keccak256(bytes(_name)),
                keccak256(bytes(_version)),
                _chainId,
                _verifyingContract
            )
        );
    }

    /// @notice Returns the current EIP‑712 domain separator.
    function domainSeparator() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    // ----------------------------------------------------------------------- //
    //  Admin Functions
    // ----------------------------------------------------------------------- //
    function addValidator(address _validator) external onlyOwner {
        if (_validator == address(0)) revert CrossChainBridge__ZeroAddress();
        if (validators[_validator]) revert CrossChainBridge__AlreadyValidator();
        validators[_validator] = true;
        emit ValidatorAdded(_validator);
    }

    function removeValidator(address _validator) external onlyOwner {
        if (!validators[_validator]) revert CrossChainBridge__NotValidator();
        validators[_validator] = false;
        emit ValidatorRemoved(_validator);
    }

    /// @notice Updates the contract version (used for upgrade safety tests).
    function setVersion(string memory _newVersion) external onlyOwner {
        version = _newVersion;
        emit VersionUpdated(_newVersion);
    }

    // ----------------------------------------------------------------------- //
    //  Core Transfer Logic
    // ----------------------------------------------------------------------- //
    /// @notice Processes a signed transfer. Replay protection is built into the
    ///         EIP‑712 domain (chainId, contract address, version) and a per‑sender nonce.
    function processTransfer(
        address _sender,
        address _to,
        uint256 _amount,
        uint256 _nonce,
        bytes calldata _signature
    ) external payable {
        // Input validation
        if (_sender == address(0) || _to == address(0)) revert CrossChainBridge__ZeroAddress();
        if (_nonce != nonces[_sender]) revert CrossChainBridge__InvalidNonce();
        if (_amount > address(this).balance) revert CrossChainBridge__InsufficientBalance();
        if (_signature.length != 65) revert CrossChainBridge__InvalidSignature();

        // EIP‑712 digest
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                _sender,
                _to,
                _amount,
                _nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));

        // Signature verification with malleability protection (low‑s)
        (bytes32 r, bytes32 s, uint8 v) = _splitSignature(_signature);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert CrossChainBridge__HighS();
        }
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || !validators[recovered]) revert CrossChainBridge__InvalidSignature();

        // Consume nonce (prevents same‑chain replay)
        nonces[_sender] = _nonce + 1;

        // Transfer native tokens
        (bool success, ) = _to.call{value: _amount}("");
        if (!success) revert CrossChainBridge__TransferFailed();

        emit TransferProcessed(_sender, _to, _amount, _nonce);
    }

    /// @notice Query the next nonce for a sender (for frontend integration).
    function getNonce(address _sender) external view returns (uint256) {
        return nonces[_sender];
    }

    /// @notice Allows the contract to receive native tokens (via `receive` or `processTransfer`).
    receive() external payable {}

    // ----------------------------------------------------------------------- //
    //  Internal Helpers
    // ----------------------------------------------------------------------- //
    /// @dev Splits a 65‑byte signature into (r, s, v).
    function _splitSignature(bytes calldata sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 0x20))
            v := byte(0, calldataload(add(sig.offset, 0x40)))
        }
    }
}