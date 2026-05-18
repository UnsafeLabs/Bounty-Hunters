solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CrossChainBridge
 * @notice Facilitates token (ERC20 & native) transfers between chains using a validator
 *         signature scheme with EIP-712 typed structured data. Includes replay protection
 *         via nonces, chain ID binding, contract address binding, and implementation version.
 * @dev The domain separator includes the implementation version as part of the version string.
 *      Validators sign the Transfer struct. Contract must have sufficient balance for native
 *      transfers or token approvals for ERC20.
 */
contract CrossChainBridge {
    // ─────────────────────────────────────────────
    //  State Variables
    // ─────────────────────────────────────────────

    address public owner;
    mapping(address => bool) public validators;
    mapping(address => uint256) public nonces;

    /// @notice EIP-712 domain separator (recomputed on updateDomainSeparator or version bump)
    bytes32 public domainSeparator;

    /// @notice Implementation version – incremented by owner after each proxy upgrade
    uint256 public implementationVersion;

    // ─────────────────────────────────────────────
    //  Constants (EIP-712)
    // ─────────────────────────────────────────────

    /// @notice EIP-712 typehash for the Transfer struct
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256(
            "Transfer(address sender,address to,uint256 amount,uint256 nonce,address token)"
        );

    /// @notice EIP-712 domain typehash
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    /// @dev Immutable domain name hash
    bytes32 private immutable _NAME_HASH = keccak256("CrossChainBridge");

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────

    event TransferInitiated(
        address indexed sender,
        address indexed to,
        uint256 amount,
        uint256 nonce,
        address indexed token
    );

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event DomainSeparatorUpdated(bytes32 newDomainSeparator);
    event Withdrawal(address indexed owner, uint256 amount);
    event TokenWithdrawal(address indexed owner, address indexed token, uint256 amount);
    event ImplementationVersionUpdated(uint256 newVersion);

    // ─────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ─────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────

    error NotOwner();
    error ZeroAddress();
    error InvalidNonce();
    error InvalidSignature();
    error InvalidSignatureLength();
    error TransferFailed();
    error TokenTransferFailed();
    error InsufficientBalance();
    error AmountMustBePositive();
    error NonceOverflow();
    error InvalidValidator();

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    /// @notice Initializes contract, sets deployer as owner, computes domain separator.
    constructor() {
        owner = msg.sender;
        implementationVersion = 1;
        _computeDomainSeparator();
    }

    // ─────────────────────────────────────────────
    //  Owner Functions
    // ─────────────────────────────────────────────

    /// @notice Adds a new validator.
    /// @param validator Address to add.
    function addValidator(address validator) external onlyOwner {
        if (validator == address(0)) revert ZeroAddress();
        if (validators[validator]) revert InvalidValidator();
        validators[validator] = true;
        emit ValidatorAdded(validator);
    }

    /// @notice Removes an existing validator.
    /// @param validator Address to remove.
    function removeValidator(address validator) external onlyOwner {
        if (validator == address(0)) revert ZeroAddress();
        if (!validators[validator]) revert InvalidValidator();
        validators[validator] = false;
        emit ValidatorRemoved(validator);
    }

    /// @notice Updates the EIP-712 domain separator (e.g., after chain ID change).
    function updateDomainSeparator() external onlyOwner {
        _computeDomainSeparator();
    }

    /// @notice Increments the implementation version, which invalidates all previous signed messages.
    /// @dev Must be called after each proxy upgrade to prevent replay of old signatures.
    function incrementImplementationVersion() external onlyOwner {
        unchecked {
            implementationVersion++;
        }
        _computeDomainSeparator();
        emit ImplementationVersionUpdated(implementationVersion);
    }

    /// @notice Withdraws all native ETH held by the contract.
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance == 0) revert TransferFailed();
        (bool sent, ) = payable(owner).call{value: balance}("");
        if (!sent) revert TransferFailed();
        emit Withdrawal(owner, balance);
    }

    /// @notice Withdraws all ERC20 tokens of a given contract.
    /// @param token ERC20 token address.
    function withdrawToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        IERC20 erc20 = IERC20(token);
        uint256 balance = erc20.balanceOf(address(this));
        if (balance == 0) revert TransferFailed();
        bool success = erc20.transfer(owner, balance);
        if (!success) revert TokenTransferFailed();
        emit TokenWithdrawal(owner, token, balance);
    }

    // ─────────────────────────────────────────────
    //  Public / External Functions
    // ─────────────────────────────────────────────

    /// @notice Returns the current nonce for a sender (frontend integration).
    /// @param sender Address to query.
    /// @return Current nonce.
    function getNonce(address sender) external view returns (uint256) {
        return nonces[sender];
    }

    /**
     * @notice Processes a cross‑chain transfer signed by a validator.
     * @param sender    Address initiating the transfer.
     * @param to        Recipient address.
     * @param amount    Amount of ETH or ERC20 tokens. Must be > 0.
     * @param nonce     Replay‑protection nonce (must equal sender’s current nonce).
     * @param token     ERC20 token address (address(0) for native ETH).
     * @param signature EIP‑712 typed signature (65 bytes: r, s, v).
     */
    function processTransfer(
        address sender,
        address to,
        uint256 amount,
        uint256 nonce,
        address token,
        bytes calldata signature
    ) external {
        // Input validation
        if (sender == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert AmountMustBePositive();
        if (nonces[sender] != nonce) revert InvalidNonce();

        // Prevent nonce overflow: ensure we can increment safely
        if (nonce >= type(uint256).max) revert NonceOverflow();

        // Build EIP‑712 digest
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_TYPEHASH, sender, to, amount, nonce, token)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        );

        // Recover and verify validator
        address signer = _recoverSigner(digest, signature);
        if (!validators[signer]) revert InvalidSignature();

        // Update nonce (replay protection)
        unchecked {
            nonces[sender] = nonce + 1;
        }

        // Execute transfer
        if (token == address(0)) {
            // Native ETH transfer
            if (address(this).balance < amount) revert InsufficientBalance();
            (bool sent, ) = payable(to).call{value: amount}("");
            if (!sent) revert TransferFailed();
        } else {
            // ERC20 transfer
            IERC20 erc20 = IERC20(token);
            bool success = erc20.transferFrom(sender, to, amount);
            if (!success) revert TokenTransferFailed();
        }

        emit TransferInitiated(sender, to, amount, nonce, token);
    }

    // ─────────────────────────────────────────────
    //  Internal Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Computes the EIP-712 domain separator.
     * @dev Uses current chainId, contract address, name hash, and version derived from
     *      implementationVersion.
     */
    function _computeDomainSeparator() internal {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        bytes32 versionHash = keccak256(bytes(string(abi.encode(implementationVersion))));
        domainSeparator = keccak256(
            abi.encode(
                _DOMAIN_TYPEHASH,
                _NAME_HASH,
                versionHash,
                chainId,
                address(this)
            )
        );
        emit DomainSeparatorUpdated(domainSeparator);
    }

    /**
     * @notice Recovers the signer from a typed EIP-712 signature.
     * @param digest    The signed digest (prefixed with 0x1901).
     * @param signature Signature bytes (65 bytes: r, s, v).
     * @return signer The recovered address (zero address if invalid).
     */
    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;

        // Assembly to extract r, s, v
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        // v adjustment for Ethereum >= 155
        if (v < 27) {
            v += 27;
        }

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    // ─────────────────────────────────────────────
    //  Fallback / Receive
    // ─────────────────────────────────────────────

    /// @notice Allows contract to receive ETH (for native transfers).
    receive() external payable {}
}