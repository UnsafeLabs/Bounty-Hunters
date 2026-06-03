// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

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

        token.transfer(alice, 10_000e18);
        token.transfer(address(bridge), 100_000e18);
    }

    // ── Helpers ──

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

    // ── Happy Path ──

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

    // ── Cross-Chain Replay Prevention ──

    function test_crossChainReplay_differentChainId() public {
        _processTransfer(bob, 1000e18, 1, alice, 0);

        uint256 originalChainId = block.chainid;
        bytes32 originalTypedHash = _getTypedDataHash(bob, 1000e18, 1, alice, 0);
        bytes memory originalSig = _sign(originalTypedHash, validatorPk);

        vm.chainId(originalChainId + 1);
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(bob, 1000e18, 1, alice, 0, originalSig);
    }

    function test_domainSeparator_includesChainId() public {
        bytes32 sep1 = bridge.domainSeparator();
        uint256 originalChainId = block.chainid;
        vm.chainId(originalChainId + 1);
        bytes32 sep2 = bridge.domainSeparator();
        assertNotEq(sep1, sep2);
        vm.chainId(originalChainId);
    }

    // ── Same-Chain Replay Prevention (nonce) ──

    function test_sameChainReplay_noncePreventsReuse() public {
        _processTransfer(bob, 100e18, 1, alice, 0);
        vm.expectRevert("Invalid sender nonce");
        _processTransfer(carol, 200e18, 2, alice, 0);
    }

    function test_differentSenders_independentNonces() public {
        _processTransfer(bob, 100e18, 1, alice, 0);
        assertEq(bridge.senderNonces(alice), 1);
        _processTransfer(bob, 50e18, 2, carol, 0);
        assertEq(bridge.senderNonces(carol), 1);
    }

    // ── Post-Upgrade Replay Prevention ──

    function test_postUpgradeReplay_differentContractAddress() public {
        _processTransfer(bob, 100e18, 1, alice, 0);

        CrossChainBridge bridge2 = new CrossChainBridge(address(token), validator);
        token.transfer(address(bridge2), 100_000e18);

        bytes32 typedDataHash1 = _getTypedDataHash(bob, 100e18, 1, alice, 0);
        bytes memory sig1 = _sign(typedDataHash1, validatorPk);

        vm.expectRevert("Invalid signature");
        bridge2.processTransfer(bob, 100e18, 1, alice, 0, sig1);
    }

    // ── Invalid Signature (zero-address) ──

    function test_invalidSignature_zeroAddressRejected() public {
        bytes memory invalidSig = new bytes(65);
        vm.expectRevert("Invalid signature: zero address");
        bridge.verifySignature(keccak256("data"), invalidSig);
    }

    function test_verifySignature_rejectsWrongSigner() public {
        bytes32 hash = keccak256("test");
        bytes32 ethSigned = _ethSignedHash(hash);
        bytes memory sig = _sign(ethSigned, alicePk);
        assertFalse(bridge.verifySignature(hash, sig));
    }

    // ── EIP-712 Verification ──

    function test_eip712_domainSeparator_correctlyConstructed() public view {
        bytes32 expected = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));
        assertEq(bridge.domainSeparator(), expected);
    }

    function test_domainSeparator_recalculatesOnChainIdChange() public {
        bytes32 sep1 = bridge.domainSeparator();
        uint256 originalChainId = block.chainid;
        vm.chainId(originalChainId + 1);
        bytes32 sep2 = bridge.domainSeparator();
        assertNotEq(sep1, sep2);
        vm.chainId(originalChainId);
    }

    // ── Nonce Queryable Per Sender ──

    function test_senderNonce_queryable() public {
        assertEq(bridge.senderNonces(alice), 0);
        _processTransfer(bob, 100e18, 1, alice, 0);
        assertEq(bridge.senderNonces(alice), 1);
    }
}
