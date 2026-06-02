// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBridge {
    IERC20 public bridgeToken;
    address public validator;
    uint256 public nonce;

    mapping(bytes32 => bool) public processedTransfers;
    // FIX #4: Per-sender nonce tracking to prevent same-chain replay
    mapping(address => uint256) public senderNonces;

    // EIP-712 domain separator components
    string public constant DOMAIN_NAME = "CrossChainBridge";
    string public constant DOMAIN_VERSION = "1";
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address recipient,uint256 amount,uint256 transferNonce,address sender,uint256 senderNonce)");

    // Cache the domain separator for gas efficiency; recalculate if chainId changes
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

    /// @notice Returns the EIP-712 domain separator, recalculating if chain ID changed
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

    /// @notice Process a cross-chain transfer with full replay protection
    /// @param recipient Address receiving tokens on this chain
    /// @param amount Token amount
    /// @param transferNonce Global nonce for uniqueness
    /// @param sender Original sender on the source chain
    /// @param senderNonce Per-sender nonce for same-chain replay prevention
    /// @param signature Validator signature over EIP-712 typed data
    function processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        address sender,
        uint256 senderNonce,
        bytes calldata signature
    ) external {
        // FIX #4: Enforce per-sender nonce ordering
        require(senderNonce == senderNonces[sender], "Invalid sender nonce");
        senderNonces[sender] = senderNonce + 1;

        // FIX #1 & #2 & EIP-712: Include block.chainid and address(this) in hash
        // via structured EIP-712 typed data hashing
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

        // Also compute a legacy-style hash for the processedTransfers mapping
        // that includes chainId and contract address for replay protection
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            sender,
            senderNonce,
            block.chainid,    // FIX #1: Prevents cross-chain replay
            address(this)     // FIX #2: Prevents replay after proxy upgrade
        ));

        require(!processedTransfers[transferHash], "Already processed");
        require(verifySignature(typedDataHash, signature), "Invalid signature");

        processedTransfers[transferHash] = true;
        bridgeToken.transfer(recipient, amount);

        emit TransferProcessed(transferHash, recipient, amount);
    }

    /// @notice Verify a validator signature with zero-address protection
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

        // FIX #3: Prevent zero-address attack — ecrecover returns address(0)
        // for invalid signatures, and if validator == address(0) this would pass
        require(recovered != address(0), "Invalid signature: zero address");
        return recovered == validator;
    }

    function getPoolBalance() external view returns (uint256) {
        return bridgeToken.balanceOf(address(this));
    }

    /// @dev Build the EIP-712 domain separator
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
