// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";

/// @title MockERC20 - Minimal ERC20 for testing
contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @title CrossChainBridgeTest - Foundry tests for CrossChainBridge replay attack fix
contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    CrossChainBridge public bridge2; // second bridge simulating different chain / post-upgrade
    MockERC20 public token;
    uint256 internal validatorPrivateKey;
    address internal validator;

    function setUp() public {
        validatorPrivateKey = 0xBEEF;
        validator = vm.addr(validatorPrivateKey);

        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), address(validator));

        // Simulate a second chain by deploying with a different chainId via vm.chainId
        // We deploy bridge2 at same code but it will have a different DOMAIN_SEPARATOR
        // because we change chainId before deployment
        uint256 originalChainId = block.chainid;
        vm.chainId(137); // Polygon
        bridge2 = new CrossChainBridge(address(token), address(validator));
        vm.chainId(originalChainId);

        // Fund both bridges
        token.mint(address(bridge), 1000e18);
        token.mint(address(bridge2), 1000e18);
    }

    function _signTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce
    ) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(recipient, amount, transferNonce, block.chainid, address(bridge)));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    function _signTransferForBridge(
        CrossChainBridge targetBridge,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 chainId
    ) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(recipient, amount, transferNonce, chainId, address(targetBridge)));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    // ─── Test: valid transfer works ────────────────────────────────
    function test_validTransfer() external {
        address recipient = address(0x1234);
        bytes memory sig = _signTransfer(recipient, 100e18, 0);

        vm.prank(address(0xdead)); // any caller
        bridge.processTransfer(recipient, 100e18, 0, sig);

        assertEq(token.balanceOf(recipient), 100e18);
    }

    // ─── Test: cross-chain replay is blocked ───────────────────────
    function test_crossChainReplayBlocked() external {
        address recipient = address(0x1234);

        // Create signature for chain 1 (bridge)
        bytes memory sig = _signTransfer(recipient, 100e18, 0);

        // Process on bridge (chain 1) — should work
        bridge.processTransfer(recipient, 100e18, 0, sig);

        // Try replaying on bridge2 (different chain) with same params — should fail
        // because hash includes block.chainid and address(bridge2), so signature
        // won't verify on the other chain (this IS the cross-chain replay protection)
        vm.expectRevert("Invalid signature");
        bridge2.processTransfer(recipient, 100e18, 0, sig);
    }

    // ─── Test: same-chain replay is blocked ────────────────────────
    function test_sameChainReplayBlocked() external {
        address recipient = address(0x1234);
        bytes memory sig = _signTransfer(recipient, 100e18, 0);

        bridge.processTransfer(recipient, 100e18, 0, sig);

        // Try exact same call again — should revert with "Already processed"
        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, 100e18, 0, sig);
    }

    // ─── Test: post-upgrade replay is blocked ──────────────────────
    function test_postUpgradeReplayBlocked() external {
        address recipient = address(0x1234);
        uint256 amount = 100e18;
        uint256 transferNonce = 42;

        // Sign for bridge (original contract)
        bytes memory sig = _signTransfer(recipient, amount, transferNonce);

        // Process on original bridge
        bridge.processTransfer(recipient, amount, transferNonce, sig);

        // Deploy "upgraded" bridge at a different address (simulating proxy upgrade)
        CrossChainBridge upgradedBridge = new CrossChainBridge(address(token), address(validator));
        token.mint(address(upgradedBridge), 1000e18);

        // Signature was for address(bridge), not address(upgradedBridge) — hash won't match
        vm.expectRevert("Invalid signature");
        upgradedBridge.processTransfer(recipient, amount, transferNonce, sig);
    }

    // ─── Test: invalid signature is rejected ───────────────────────
    function test_invalidSignatureRejected() external {
        address recipient = address(0x1234);

        // Create a signature with wrong validator key
        uint256 wrongKey = 0xDEAD;
        uint256 amount = 100e18;
        bytes32 hash = keccak256(abi.encodePacked(recipient, amount, uint256(0), block.chainid, address(bridge)));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethSignedHash);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, 100e18, 0, badSig);
    }

    // ─── Test: zero-address signature is rejected ──────────────────
    function test_zeroAddressSignatureRejected() external {
        address recipient = address(0x1234);

        // Craft a signature that would recover to address(0)
        // Using r=0, s=0 with v=27 will recover to address(0)
        bytes memory zeroSig = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));

        vm.expectRevert("Invalid signature: zero address");
        bridge.processTransfer(recipient, 100e18, 0, zeroSig);
    }

    // ─── Test: wrong chainId in signature is rejected ──────────────
    function test_wrongChainIdRejected() external {
        address recipient = address(0x1234);

        // Sign with a different chainId (999)
        bytes memory sig = _signTransferForBridge(bridge, recipient, 100e18, 0, 999);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, 100e18, 0, sig);
    }

    // ─── Test: EIP-712 domain separator is correct ─────────────────
    function test_eip712DomainSeparator() external view {
        bytes32 expectedDomain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));
        assertEq(bridge.DOMAIN_SEPARATOR(), expectedDomain);
    }

    // ─── Test: EIP-712 transfer digest ─────────────────────────────
    function test_eip712TransferDigest() external view {
        address recipient = address(0x1234);
        uint256 amount = 100e18;
        uint256 transferNonce = 0;

        bytes32 expectedStructHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(bridge)
        ));
        bytes32 expectedDigest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), expectedStructHash));

        assertEq(bridge.getTransferDigest(recipient, amount, transferNonce), expectedDigest);
    }

    // ─── Test: nonces are queryable per sender ─────────────────────
    function test_noncesQueryable() external {
        address recipient = address(0x1234);
        assertEq(bridge.getNonce(recipient), 0);

        bytes memory sig = _signTransfer(recipient, 50e18, 0);
        bridge.processTransfer(recipient, 50e18, 0, sig);
        assertEq(bridge.getNonce(recipient), 1);
    }

    // ─── Test: multiple sequential transfers with incrementing nonces ──
    function test_sequentialTransfers() external {
        address recipient = address(0x1234);

        for (uint256 i = 0; i < 3; i++) {
            bytes memory sig = _signTransfer(recipient, 10e18, i);
            bridge.processTransfer(recipient, 10e18, i, sig);
        }

        assertEq(token.balanceOf(recipient), 30e18);
        assertEq(bridge.getNonce(recipient), 3);
    }
}
