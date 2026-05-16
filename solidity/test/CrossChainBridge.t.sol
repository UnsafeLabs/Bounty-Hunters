// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 1_000_000 ether);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockERC20 public token;
    address public validator = address(0x1234);
    address public user = address(0x5678);
    address public recipient = address(0x9ABC);

    uint256 internal userPrivateKey = 0xA1B2;

    function setUp() public {
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);

        // Label addresses for better trace output
        vm.label(validator, "Validator");
        vm.label(user, "User");
        vm.label(recipient, "Recipient");
        vm.label(address(token), "Token");
        vm.label(address(bridge), "Bridge");

        // Fund user with tokens
        token.transfer(user, 1000 ether);
    }

    // ─── Happy Path ───────────────────────────────────────────────────────────

    function test_ProcessTransfer_ValidSignature() public {
        uint256 amount = 100 ether;
        uint256 nonce = 1;

        vm.prank(user);
        token.approve(address(bridge), amount);

        vm.prank(user);
        bridge.initiateTransfer(amount, 1);

        // Build EIP-712 typed data and sign
        bytes32 digest = _buildDigest(recipient, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Process the transfer
        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);

        // Verify tokens were transferred
        assertEq(token.balanceOf(recipient), amount);
        assertTrue(bridge.processedTransfers(digest));
    }

    // ─── Cross-Chain Replay Prevention ────────────────────────────────────────

    function test_RevertWhen_CrossChainReplay() public {
        uint256 amount = 100 ether;
        uint256 nonce = 1;

        vm.prank(user);
        token.approve(address(bridge), amount);
        vm.prank(user);
        bridge.initiateTransfer(amount, 1);

        bytes32 digest = _buildDigest(recipient, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);

        // Attempt replay on a different chain — change chain ID via vm
        // This should produce a different digest, so the original signature won't match
        // We simulate by signing with a different chain ID expectation
        vm.chainId(31338); // different chain

        bytes32 differentChainDigest = _buildDigest(recipient, amount, nonce);
        // The original signature should NOT be valid on this chain because the domain
        // separator includes chainId — the user would need to re-sign
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(userPrivateKey, differentChainDigest);
        bytes memory sig2 = abi.encodePacked(r2, s2, v2);

        // Should succeed on the new chain with a proper signature (it's a valid transfer)
        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, sig2);

        // But: the same digest cannot be processed twice on the same chain
        vm.chainId(31337); // back to original
        vm.expectRevert("Already processed");
        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);

        // The chain 31338 signature should NOT work on chain 31337
        vm.expectRevert("Invalid signature");
        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, sig2);
    }

    // ─── Same-Chain Replay Prevention ─────────────────────────────────────────

    function test_RevertWhen_DoubleProcess() public {
        uint256 amount = 50 ether;
        uint256 nonce = 2;

        vm.prank(user);
        token.approve(address(bridge), amount);
        vm.prank(user);
        bridge.initiateTransfer(amount, 1);

        bytes32 digest = _buildDigest(recipient, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);

        // Same call again should revert
        vm.expectRevert("Already processed");
        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);
    }

    // ─── Post-Upgrade Replay Prevention ───────────────────────────────────────

    function test_RevertWhen_PostUpgradeReplay() public {
        uint256 amount = 75 ether;
        uint256 nonce = 3;

        vm.prank(user);
        token.approve(address(bridge), amount);
        vm.prank(user);
        bridge.initiateTransfer(amount, 1);

        bytes32 digest = _buildDigest(recipient, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);

        // Deploy a new implementation (simulates proxy upgrade)
        // The new contract has a different address → different domain separator
        CrossChainBridge newBridge = new CrossChainBridge(address(token), validator);

        // The old signature should NOT work on the new contract
        vm.expectRevert("Invalid signature");
        vm.prank(recipient);
        newBridge.processTransfer(recipient, amount, nonce, signature);
    }

    // ─── Invalid Signature / ecrecover Zero-Address ───────────────────────────

    function test_RevertWhen_InvalidSignature() public {
        uint256 amount = 10 ether;
        uint256 nonce = 4;

        // Create a completely bogus signature (not signed by validator)
        bytes memory bogusSignature = abi.encodePacked(
            bytes32(0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef),
            bytes32(0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe),
            uint8(28)
        );

        vm.expectRevert("Invalid signature: zero-address recovered");
        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, bogusSignature);
    }

    function test_RevertWhen_SignatureByWrongKey() public {
        uint256 amount = 20 ether;
        uint256 nonce = 5;

        // Sign with a different private key (not the one the validator knows)
        bytes32 digest = _buildDigest(recipient, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0x9999, digest); // random key
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature"); // recovers to wrong address
        vm.prank(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);
    }

    // ─── EIP-712 Domain Separator ─────────────────────────────────────────────

    function test_DomainSeparatorIsCorrect() public {
        bytes32 expectedSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));
        assertEq(bridge.getDomainSeparator(), expectedSeparator);
    }

    function test_DomainSeparatorChangesWithChainId() public {
        bytes32 originalSeparator = bridge.getDomainSeparator();

        vm.chainId(999);
        // Deploy new bridge on different chain
        CrossChainBridge bridge2 = new CrossChainBridge(address(token), validator);
        bytes32 differentSeparator = bridge2.getDomainSeparator();

        assertFalse(originalSeparator == differentSeparator);
    }

    // ─── Nonce Queryable ──────────────────────────────────────────────────────

    function test_TransferNonceIsUnique() public {
        // Each digest has its own nonce — since nonce is part of the struct hash,
        // two transfers with different nonces produce different digests
        uint256 amount = 30 ether;

        bytes32 digest1 = _buildDigest(recipient, amount, 1);
        bytes32 digest2 = _buildDigest(recipient, amount, 2);

        assertFalse(digest1 == digest2);
    }

    // ─── Helper: Build EIP-712 digest ─────────────────────────────────────────

    function _buildDigest(
        address _recipient,
        uint256 _amount,
        uint256 _nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)"),
            _recipient,
            _amount,
            _nonce
        ));

        return keccak256(abi.encodePacked(
            "\x19\x01",
            bridge.getDomainSeparator(),
            structHash
        ));
    }
}
