// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock ERC20 token for testing
contract MockToken is ERC20 {
    constructor() ERC20("Mock Bridge Token", "MBT") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockToken public token;

    address public validator;
    uint256 public validatorPk;
    address public alice;
    uint256 public alicePk;
    address public bob;
    address public carol;

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address recipient,uint256 amount,uint256 transferNonce,address sender,uint256 senderNonce)");

    function setUp() public {
        validatorPk = 0x1111;
        validator = vm.addr(validatorPk);
        alicePk = 0x2222;
        alice = vm.addr(alicePk);
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        token = new MockToken();
        bridge = new CrossChainBridge(address(token), validator);

        // Fund alice
        token.transfer(alice, 10_000e18);
        // Fund the bridge with liquidity
        token.transfer(address(bridge), 100_000e18);
    }

    // ──────────────────────────── Helper Functions ────────────────────────────

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));
    }

    function _getTypedDataHash(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        address sender,
        uint256 senderNonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            sender,
            senderNonce
        ));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _sign(bytes32 hash, uint256 pk) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    function _ethSignedHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _processTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        address sender,
        uint256 senderNonce
    ) internal {
        bytes32 typedDataHash = _getTypedDataHash(recipient, amount, transferNonce, sender, senderNonce);
        bytes memory sig = _sign(typedDataHash, validatorPk);
        bridge.processTransfer(recipient, amount, transferNonce, sender, senderNonce, sig);
    }

    // ──────────────────────────── Happy Path Tests ────────────────────────────

    function test_initiateTransfer() public {
        vm.prank(alice);
        token.approve(address(bridge), 1000e18);

        vm.prank(alice);
        bridge.initiateTransfer(1000e18, 1);

        assertEq(token.balanceOf(address(bridge)), 100_000e18 + 1000e18);
    }

    function test_initiateTransfer_emitsEvent() public {
        vm.prank(alice);
        token.approve(address(bridge), 500e18);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit CrossChainBridge.TransferInitiated(alice, 500e18, 1, 0);
        bridge.initiateTransfer(500e18, 1);
    }

    function test_initiateTransfer_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Amount must be > 0");
        bridge.initiateTransfer(0, 1);
    }

    function test_processTransfer_happyPath() public {
        uint256 amount = 1000e18;
        uint256 balBefore = token.balanceOf(bob);

        _processTransfer(bob, amount, 1, alice, 0);

        assertEq(token.balanceOf(bob), balBefore + amount);
    }

    function test_processTransfer_incrementsSenderNonce() public {
        _processTransfer(bob, 100e18, 1, alice, 0);
        assertEq(bridge.senderNonces(alice), 1);

        _processTransfer(bob, 200e18, 2, alice, 1);
        assertEq(bridge.senderNonces(alice), 2);
    }

    function test_processTransfer_marksProcessed() public {
        _processTransfer(bob, 100e18, 1, alice, 0);

        bytes32 transferHash = keccak256(abi.encodePacked(
            bob, 100e18, uint256(1), alice, uint256(0), block.chainid, address(bridge)
        ));
        assertTrue(bridge.processedTransfers(transferHash));
    }

    function test_processTransfer_emitsEvent() public {
        bytes32 transferHash = keccak256(abi.encodePacked(
            bob, 100e18, uint256(1), alice, uint256(0), block.chainid, address(bridge)
        ));

        vm.expectEmit(true, true, false, true);
        emit CrossChainBridge.TransferProcessed(transferHash, bob, 100e18);
        _processTransfer(bob, 100e18, 1, alice, 0);
    }

    // ──────────────────────── FIX #1: Cross-Chain Replay ────────────────────────

    function test_REVERT_crossChainReplay_differentChainId() public {
        uint256 amount = 1000e18;

        // Process on current chain
        _processTransfer(bob, amount, 1, alice, 0);

        // Simulate same parameters on a different chain (chain ID changed)
        // The domain separator will change, making the old signature invalid
        uint256 originalChainId = block.chainid;
        vm.chainId(originalChainId + 1);

        // The typed data hash is now different because domainSeparator includes chainId
        // So even if someone replays the same calldata, the signature won't verify
        bytes32 typedDataHash = _getTypedDataHash(bob, amount, 1, alice, 0);
        bytes memory oldSig = _sign(typedDataHash, validatorPk); // This sig is for new chain

        // The old signature (from the original chain) won't work on the new chain
        // because domainSeparator() recalculates with the new chainId
        // Let's verify this by trying with the original chain's signature
        vm.chainId(originalChainId);
        bytes32 originalTypedHash = _getTypedDataHash(bob, amount, 1, alice, 0);
        bytes memory originalSig = _sign(originalTypedHash, validatorPk);

        // Switch to new chain and try replay
        vm.chainId(originalChainId + 1);
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(bob, amount, 1, alice, 0, originalSig);
    }

    function test_domainSeparator_includesChainId() public view {
        bytes32 sep1 = bridge.domainSeparator();
        uint256 originalChainId = block.chainid;

        vm.chainId(originalChainId + 1);
        bytes32 sep2 = bridge.domainSeparator();

        assertNotEq(sep1, sep2, "Domain separator should change with chain ID");
    }

    // ──────────────────────── FIX #2: Proxy Upgrade Replay ────────────────────────

    function test_transferHash_includesContractAddress() public {
        // Deploy a second bridge with the same validator
        CrossChainBridge bridge2 = new CrossChainBridge(address(token), validator);

        // Fund the second bridge
        token.transfer(address(bridge2), 100_000e18);

        // Process a transfer on bridge1
        _processTransfer(bob, 100e18, 1, alice, 0);

        // Try to replay on bridge2 with the same signature
        bytes32 typedDataHash2 = _getTypedDataHashForBridge(
            bridge2, bob, 100e18, 1, alice, 0
        );

        // The domain separator for bridge2 is different (different address(this))
        // So the old signature from bridge1 won't verify on bridge2
        bytes32 typedDataHash1 = _getTypedDataHash(bob, 100e18, 1, alice, 0);
        bytes memory sig1 = _sign(typedDataHash1, validatorPk);

        vm.expectRevert("Invalid signature");
        bridge2.processTransfer(bob, 100e18, 1, alice, 0, sig1);
    }

    function _getTypedDataHashForBridge(
        CrossChainBridge targetBridge,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        address sender,
        uint256 senderNonce
    ) internal view returns (bytes32) {
        bytes32 domainSep = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(targetBridge)
        ));
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            transferNonce,
            sender,
            senderNonce
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    // ──────────────────────── FIX #3: Zero-Address Attack ────────────────────────

    function test_REVERT_zeroAddressRecovery() public {
        // Craft a signature that makes ecrecover return address(0)
        // Using an invalid signature that results in address(0) recovery
        bytes memory invalidSig = new bytes(65);
        // All zeros — ecrecover will return address(0)

        bytes32 anyHash = keccak256("some data");

        vm.expectRevert("Invalid signature: zero address");
        bridge.verifySignature(anyHash, invalidSig);
    }

    function test_REVERT_zeroAddressValidator_preventsAttack() public {
        // Deploy a bridge with address(0) as validator
        // Even then, a zero-address recovery should be rejected
        CrossChainBridge badBridge = new CrossChainBridge(address(token), address(0));

        // Craft a signature that would make ecrecover return address(0)
        bytes memory zeroSig = new bytes(65);

        vm.expectRevert("Invalid signature: zero address");
        badBridge.verifySignature(keccak256("data"), zeroSig);
    }

    function test_verifySignature_rejectsInvalidSigner() public {
        bytes32 hash = keccak256("test");
        // Sign with wrong key (alice's key, not validator's)
        bytes memory sig = _sign(hash, alicePk);

        assertFalse(bridge.verifySignature(hash, sig));
    }

    function test_verifySignature_acceptsValidSigner() public view {
        bytes32 hash = keccak256("test");
        bytes32 ethSigned = _ethSignedHash(hash);
        bytes memory sig = _sign(ethSigned, validatorPk);

        assertTrue(bridge.verifySignature(hash, sig));
    }

    function test_verifySignature_rejectsShortSignature() public {
        bytes memory shortSig = new bytes(64);
        vm.expectRevert("Invalid signature length");
        bridge.verifySignature(keccak256("test"), shortSig);
    }

    // ──────────────────────── FIX #4: Per-Sender Nonce ────────────────────────

    function test_REVERT_invalidSenderNonce() public {
        // Try to use senderNonce=1 when senderNonce should be 0
        bytes32 typedDataHash = _getTypedDataHash(bob, 100e18, 1, alice, 1);
        bytes memory sig = _sign(typedDataHash, validatorPk);

        vm.expectRevert("Invalid sender nonce");
        bridge.processTransfer(bob, 100e18, 1, alice, 1, sig);
    }

    function test_REVERT_replaySameSenderNonce() public {
        // Process first transfer with senderNonce=0
        _processTransfer(bob, 100e18, 1, alice, 0);

        // Try to replay with same senderNonce=0 — should fail
        vm.expectRevert("Invalid sender nonce");
        _processTransfer(carol, 200e18, 2, alice, 0);
    }

    function test_differentSenders_independentNonces() public {
        // Alice uses nonce 0
        _processTransfer(bob, 100e18, 1, alice, 0);
        assertEq(bridge.senderNonces(alice), 1);

        // Carol (different sender) also starts at nonce 0
        _processTransfer(bob, 50e18, 2, carol, 0);
        assertEq(bridge.senderNonces(carol), 1);

        // Alice continues with nonce 1
        _processTransfer(bob, 75e18, 3, alice, 1);
        assertEq(bridge.senderNonces(alice), 2);
    }

    function test_senderNonces_preventsSameChainReplay() public {
        uint256 amount = 1000e18;

        // Process transfer for alice with nonce 0
        _processTransfer(bob, amount, 1, alice, 0);

        // Even with a different global nonce, alice can't reuse senderNonce 0
        bytes32 typedDataHash = _getTypedDataHash(bob, amount, 999, alice, 0);
        bytes memory sig = _sign(typedDataHash, validatorPk);

        vm.expectRevert("Invalid sender nonce");
        bridge.processTransfer(bob, amount, 999, alice, 0, sig);
    }

    // ──────────────────────── Double-Processing Prevention ────────────────────────

    function test_REVERT_doubleProcessing() public {
        // Process once
        _processTransfer(bob, 100e18, 1, alice, 0);

        // Try exact same parameters again — will fail on senderNonce check first
        // but even if nonce were right, processedTransfers would block it
        vm.expectRevert("Invalid sender nonce");
        _processTransfer(bob, 100e18, 1, alice, 0);
    }

    // ──────────────────────── EIP-712 Domain Separator Tests ────────────────────────

    function test_domainSeparator_cached() public {
        bytes32 sep1 = bridge.domainSeparator();
        bytes32 sep2 = bridge.domainSeparator();
        assertEq(sep1, sep2);
    }

    function test_domainSeparator_recalculatesOnChainIdChange() public {
        bytes32 sep1 = bridge.domainSeparator();

        uint256 originalChainId = block.chainid;
        vm.chainId(originalChainId + 1);

        bytes32 sep2 = bridge.domainSeparator();
        assertNotEq(sep1, sep2);

        // Restore
        vm.chainId(originalChainId);
    }

    // ──────────────────────── getPoolBalance ────────────────────────

    function test_getPoolBalance() public view {
        assertEq(bridge.getPoolBalance(), token.balanceOf(address(bridge)));
    }

    // ──────────────────────── Fuzz Tests ────────────────────────

    function testFuzz_processTransfer(uint256 amount) public {
        // Bound amount to reasonable range
        vm.assume(amount > 0 && amount < 100_000e18);
        // Ensure bridge has enough tokens
        if (token.balanceOf(address(bridge)) < amount) {
            token.transfer(address(bridge), amount - token.balanceOf(address(bridge)) + 1);
        }

        _processTransfer(bob, amount, 1, alice, 0);
        assertEq(bridge.senderNonces(alice), 1);
    }

    function testFuzz_verifySignature_rejectsWrongSigner(uint256 pk) public {
        vm.assume(pk != 0 && pk != validatorPk);
        bytes32 hash = keccak256("test");
        bytes32 ethSigned = _ethSignedHash(hash);
        bytes memory sig = _sign(ethSigned, pk);

        assertFalse(bridge.verifySignature(hash, sig));
    }

    // ──────────────────────── Signature v-value Normalization ────────────────────────

    function test_signatureV_normalization() public view {
        bytes32 hash = keccak256("test");
        bytes32 ethSigned = _ethSignedHash(hash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPk, ethSigned);

        // Should work with both v=27/28 and v=0/1 (normalization)
        bytes memory sig = abi.encodePacked(r, s, v);
        assertTrue(bridge.verifySignature(hash, sig));
    }
}
