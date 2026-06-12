// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock ERC20 token for testing
contract MockToken is ERC20 {
    constructor() ERC20("MockToken", "MTK") {
        _mint(msg.sender, 1e30);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockToken public token;
    address public validator;
    uint256 private validatorPrivateKey;

    address public recipient = address(0xBEEF);
    uint256 public constant AMOUNT = 1000 ether;

    function setUp() public {
        // Generate a deterministic validator key
        validatorPrivateKey = 0xA11CE;
        validator = vm.addr(validatorPrivateKey);

        // Deploy contracts
        token = new MockToken();
        bridge = new CrossChainBridge(address(token), validator);

        // Fund the bridge
        token.transfer(address(bridge), 1e28);
    }

    // Helper: sign a message with EIP-712 structure
    function _signTransfer(
        address _recipient,
        uint256 _amount,
        uint256 _transferNonce,
        uint256 _senderNonce,
        address _contractAddress
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                _recipient,
                _amount,
                _transferNonce,
                _senderNonce,
                _contractAddress
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        // Ethereum Signed Message prefix for ecrecover compatibility
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    // ============================================================
    // TEST: Cross-chain replay prevention (chainId in hash)
    // ============================================================
    function test_CrossChainReplayPrevented() public {
        uint256 transferNonce = 0;
        uint256 senderNonce = 0;

        bytes memory sig = _signTransfer(recipient, AMOUNT, transferNonce, senderNonce, address(bridge));

        // First transfer should succeed
        bridge.processTransfer(recipient, AMOUNT, transferNonce, sig);

        // Verify chainId is embedded in the domain separator
        bytes32 domainSep = bridge.DOMAIN_SEPARATOR();
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        bytes32 expectedDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("CrossChainBridge"),
                keccak256("1"),
                chainId,
                address(bridge)
            )
        );
        assertEq(domainSep, expectedDomain, "Domain separator must include chainId");

        // Replay on same chain fails — senderNonce incremented, so the old
        // signature (which was signed with senderNonce=0) no longer verifies
        // because the contract now computes the hash with senderNonce=1.
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, AMOUNT, transferNonce, sig);
    }

    // ============================================================
    // TEST: Same-chain replay prevention (per-sender nonce)
    // ============================================================
    function test_SameChainReplayPrevented() public {
        uint256 transferNonce = 0;
        uint256 senderNonce = 0;

        bytes memory sig = _signTransfer(recipient, AMOUNT, transferNonce, senderNonce, address(bridge));

        // First transfer succeeds
        bridge.processTransfer(recipient, AMOUNT, transferNonce, sig);

        // Sender nonce should increment
        assertEq(bridge.senderNonces(address(this)), 1, "Sender nonce should increment");

        // Same signature replay should fail — the contract now computes the hash
        // with senderNonce=1, but the signature was signed with senderNonce=0,
        // so signature verification fails.
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, AMOUNT, transferNonce, sig);

        // A new signature with the CORRECT incremented nonce works
        bytes memory newSig = _signTransfer(recipient, AMOUNT, transferNonce, 1, address(bridge));
        bridge.processTransfer(recipient, AMOUNT, transferNonce, newSig);
        assertEq(bridge.senderNonces(address(this)), 2, "Sender nonce should be 2");
    }

    // ============================================================
    // TEST: Contract address in hash prevents post-upgrade replay
    // ============================================================
    function test_ContractAddressInHash() public {
        uint256 transferNonce = 0;
        uint256 senderNonce = 0;

        // Sign for this specific contract
        bytes memory sig = _signTransfer(recipient, AMOUNT, transferNonce, senderNonce, address(bridge));

        // Verify the signature works for this contract
        bridge.processTransfer(recipient, AMOUNT, transferNonce, sig);

        // Deploy a new bridge (simulating upgrade) with same validator
        CrossChainBridge newBridge = new CrossChainBridge(address(token), validator);
        token.transfer(address(newBridge), 1e28);

        // The same signature should NOT work on the new contract because
        // address(this) is included in the hash and DOMAIN_SEPARATOR
        // The DOMAIN_SEPARATOR is different because verifyingContract changed
        bytes32 oldDomain = bridge.DOMAIN_SEPARATOR();
        bytes32 newDomain = newBridge.DOMAIN_SEPARATOR();
        assertTrue(oldDomain != newDomain, "Domain separators must differ for different contracts");

        // Attempting to use old signature on new bridge should fail
        // (signature won't verify because domain separator is different)
        vm.expectRevert("Invalid signature");
        newBridge.processTransfer(recipient, AMOUNT, transferNonce, sig);
    }

    // ============================================================
    // TEST: Zero-address ecrecover check
    // ============================================================
    function test_ZeroAddressSignatureRejected() public {
        // Craft a signature that will cause ecrecover to return address(0)
        // Using v=0 (invalid) with r=0, s=0
        bytes memory badSig = abi.encodePacked(bytes32(0), bytes32(0), uint8(0));

        vm.expectRevert("Invalid signature: recovered zero address");
        bridge.processTransfer(recipient, AMOUNT, 0, badSig);
    }

    function test_InvalidSignatureRejected() public {
        // Valid format but wrong signer
        uint256 wrongKey = 0xDEAD;
        address wrongSigner = vm.addr(wrongKey);

        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                AMOUNT,
                uint256(0),
                uint256(0),
                address(bridge)
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethSignedHash);
        bytes memory wrongSig = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, AMOUNT, 0, wrongSig);
    }

    // ============================================================
    // TEST: EIP-712 domain separator correctness
    // ============================================================
    function test_EIP712DomainSeparator() public {
        bytes32 domain = bridge.DOMAIN_SEPARATOR();

        // Verify it matches the expected EIP-712 construction
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("CrossChainBridge"),
                keccak256("1"),
                block.chainid,
                address(bridge)
            )
        );

        assertEq(domain, expected, "EIP-712 domain separator mismatch");
    }

    function test_EIP712NameAndVersion() public {
        // Verify the domain separator encodes the correct name and version
        bytes32 domain = bridge.DOMAIN_SEPARATOR();

        // Recompute with wrong name — should NOT match
        bytes32 wrongName = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("WrongName"),
                keccak256("1"),
                block.chainid,
                address(bridge)
            )
        );
        assertTrue(domain != wrongName, "Domain should not match wrong name");
    }

    // ============================================================
    // TEST: Sender nonce is queryable for frontend integration
    // ============================================================
    function test_SenderNonceQueryable() public {
        // Initial nonce should be 0
        assertEq(bridge.getSenderNonce(address(this)), 0);

        // After a transfer, nonce increments
        uint256 transferNonce = 0;
        bytes memory sig = _signTransfer(recipient, AMOUNT, transferNonce, 0, address(bridge));
        bridge.processTransfer(recipient, AMOUNT, transferNonce, sig);

        assertEq(bridge.getSenderNonce(address(this)), 1);
        assertEq(bridge.senderNonces(address(this)), 1);
    }

    // ============================================================
    // TEST: Successful transfer flow
    // ============================================================
    function test_SuccessfulTransfer() public {
        uint256 recipientBalanceBefore = token.balanceOf(recipient);
        uint256 bridgeBalanceBefore = token.balanceOf(address(bridge));

        uint256 transferNonce = 0;
        bytes memory sig = _signTransfer(recipient, AMOUNT, transferNonce, 0, address(bridge));

        bridge.processTransfer(recipient, AMOUNT, transferNonce, sig);

        assertEq(token.balanceOf(recipient), recipientBalanceBefore + AMOUNT);
        assertEq(token.balanceOf(address(bridge)), bridgeBalanceBefore - AMOUNT);
    }

    // ============================================================
    // TEST: Nonce increments correctly per sender
    // ============================================================
    function test_NonceIncrementsPerSender() public {
        // First transfer
        bytes memory sig1 = _signTransfer(recipient, AMOUNT, 0, 0, address(bridge));
        bridge.processTransfer(recipient, AMOUNT, 0, sig1);
        assertEq(bridge.senderNonces(address(this)), 1);

        // Second transfer with incremented nonce
        bytes memory sig2 = _signTransfer(recipient, AMOUNT, 1, 1, address(bridge));
        bridge.processTransfer(recipient, AMOUNT, 1, sig2);
        assertEq(bridge.senderNonces(address(this)), 2);
    }

    // ============================================================
    // TEST: Invalid signature length
    // ============================================================
    function test_InvalidSignatureLength() public {
        bytes memory shortSig = new bytes(64); // 64 bytes instead of 65

        vm.expectRevert("Invalid signature length");
        bridge.processTransfer(recipient, AMOUNT, 0, shortSig);
    }

    // ============================================================
    // TEST: Zero amount transfer
    // ============================================================
    function test_ZeroAmountTransfer() public {
        // initiateTransfer should reject zero amount
        vm.expectRevert("Amount must be > 0");
        bridge.initiateTransfer(0, 1);
    }
}
