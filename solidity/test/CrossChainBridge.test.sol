// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock ERC20 for testing
contract MockToken is ERC20 {
    constructor() ERC20("MockToken", "MTK") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockToken public token;

    uint256 internal validatorPrivateKey = 0xA11CE;
    address internal validator;
    address internal recipient = address(0xBEEF);
    address internal sender = address(0xCAFE);

    uint256 internal constant SOURCE_CHAIN = 1;
    uint256 internal constant TARGET_CHAIN = 42;

    function setUp() public {
        validator = vm.addr(validatorPrivateKey);

        // Deploy on chain ID 42 (simulating target chain)
        vm.chainId(TARGET_CHAIN);

        token = new MockToken();
        bridge = new CrossChainBridge(address(token), validator);

        // Fund the bridge with tokens (simulating locked liquidity)
        token.transfer(address(bridge), 500_000 ether);

        // Fund sender for initiateTransfer tests
        token.transfer(sender, 100_000 ether);
    }

    // ─── Helper: build an EIP-712 signature ────────────────────────────

    function _signTransfer(
        address _recipient,
        uint256 _amount,
        uint256 _nonce,
        uint256 _sourceChain
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                _recipient,
                _amount,
                _nonce,
                _sourceChain
            )
        );

        bytes32 digest = _hashTypedData(structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19\x01", bridge.getDomainSeparator(), structHash)
        );
    }

    // ─── Basic functionality ───────────────────────────────────────────

    function test_processTransfer_validSignature() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        bytes memory sig = _signTransfer(recipient, amount, nonce, SOURCE_CHAIN);

        uint256 balBefore = token.balanceOf(recipient);
        bridge.processTransfer(recipient, amount, nonce, SOURCE_CHAIN, sig);
        uint256 balAfter = token.balanceOf(recipient);

        assertEq(balAfter - balBefore, amount, "Recipient should receive tokens");
        assertEq(bridge.senderNonces(recipient), 1, "Nonce should increment");
    }

    function test_processTransfer_incrementsNonce() public {
        uint256 amount = 50 ether;

        // First transfer — nonce 0
        bytes memory sig0 = _signTransfer(recipient, amount, 0, SOURCE_CHAIN);
        bridge.processTransfer(recipient, amount, 0, SOURCE_CHAIN, sig0);
        assertEq(bridge.senderNonces(recipient), 1);

        // Second transfer — nonce 1
        bytes memory sig1 = _signTransfer(recipient, amount, 1, SOURCE_CHAIN);
        bridge.processTransfer(recipient, amount, 1, SOURCE_CHAIN, sig1);
        assertEq(bridge.senderNonces(recipient), 2);
    }

    // ─── Cross-chain replay prevention ─────────────────────────────────

    function test_revert_crossChainReplay() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        // Sign for chain 42 (current chain)
        bytes memory sig = _signTransfer(recipient, amount, nonce, SOURCE_CHAIN);

        // Process on chain 42 — should succeed
        bridge.processTransfer(recipient, amount, nonce, SOURCE_CHAIN, sig);

        // Deploy a new bridge on a DIFFERENT chain (chain 99)
        vm.chainId(99);
        CrossChainBridge bridge2 = new CrossChainBridge(address(token), validator);
        token.transfer(address(bridge2), 500_000 ether);

        // Replay the same signature on chain 99 — must fail because
        // EIP-712 domain separator includes chainId
        vm.expectRevert("Invalid signature");
        bridge2.processTransfer(recipient, amount, 0, SOURCE_CHAIN, sig);
    }

    // ─── Same-chain replay prevention ──────────────────────────────────

    function test_revert_sameChainReplay() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        bytes memory sig = _signTransfer(recipient, amount, nonce, SOURCE_CHAIN);
        bridge.processTransfer(recipient, amount, nonce, SOURCE_CHAIN, sig);

        // Try to replay the same transfer — nonce is now 1, so nonce=0 is invalid
        vm.expectRevert("Invalid nonce");
        bridge.processTransfer(recipient, amount, nonce, SOURCE_CHAIN, sig);
    }

    // ─── Post-upgrade replay prevention ────────────────────────────────

    function test_revert_postUpgradeReplay() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        bytes memory sig = _signTransfer(recipient, amount, nonce, SOURCE_CHAIN);
        bridge.processTransfer(recipient, amount, nonce, SOURCE_CHAIN, sig);

        // Deploy a NEW bridge contract (simulating upgrade to different address)
        CrossChainBridge bridgeV2 = new CrossChainBridge(address(token), validator);
        token.transfer(address(bridgeV2), 500_000 ether);

        // Replay on new contract — must fail because EIP-712 domain
        // separator includes verifyingContract address
        vm.expectRevert("Invalid signature");
        bridgeV2.processTransfer(recipient, amount, 0, SOURCE_CHAIN, sig);
    }

    // ─── Invalid signature handling ────────────────────────────────────

    function test_revert_invalidSignature() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        // Sign with a different private key (not the validator)
        uint256 attackerKey = 0xBAD;
        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                nonce,
                SOURCE_CHAIN
            )
        );
        bytes32 digest = _hashTypedData(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerKey, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, nonce, SOURCE_CHAIN, badSig);
    }

    function test_revert_malformedSignature() public {
        uint256 amount = 100 ether;
        // Signature too short
        vm.expectRevert();
        bridge.processTransfer(recipient, amount, 0, SOURCE_CHAIN, hex"DEAD");
    }

    // ─── EIP-712 domain verification ───────────────────────────────────

    function test_domainSeparator_includesChainAndContract() public view {
        bytes32 ds = bridge.getDomainSeparator();
        assertTrue(ds != bytes32(0), "Domain separator should be non-zero");
    }

    // ─── Edge cases ────────────────────────────────────────────────────

    function test_revert_zeroRecipient() public {
        bytes memory sig = _signTransfer(address(0), 100 ether, 0, SOURCE_CHAIN);
        vm.expectRevert("Invalid recipient");
        bridge.processTransfer(address(0), 100 ether, 0, SOURCE_CHAIN, sig);
    }

    function test_revert_zeroAmount() public {
        bytes memory sig = _signTransfer(recipient, 0, 0, SOURCE_CHAIN);
        vm.expectRevert("Amount must be > 0");
        bridge.processTransfer(recipient, 0, 0, SOURCE_CHAIN, sig);
    }

    function test_getNonce_returnsCorrectValue() public {
        assertEq(bridge.getNonce(recipient), 0);

        bytes memory sig = _signTransfer(recipient, 100 ether, 0, SOURCE_CHAIN);
        bridge.processTransfer(recipient, 100 ether, 0, SOURCE_CHAIN, sig);

        assertEq(bridge.getNonce(recipient), 1);
    }

    function test_initiateTransfer_emitsEvent() public {
        uint256 amount = 500 ether;
        vm.startPrank(sender);
        token.approve(address(bridge), amount);

        vm.expectEmit(true, false, false, true);
        emit CrossChainBridge.TransferInitiated(sender, amount, TARGET_CHAIN + 1, 0);
        bridge.initiateTransfer(amount, TARGET_CHAIN + 1);
        vm.stopPrank();
    }

    function test_revert_initiateTransfer_sameChain() public {
        vm.startPrank(sender);
        token.approve(address(bridge), 100 ether);
        vm.expectRevert("Cannot bridge to same chain");
        bridge.initiateTransfer(100 ether, TARGET_CHAIN); // same as current chain
        vm.stopPrank();
    }
}
