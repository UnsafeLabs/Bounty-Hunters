// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/CrossChainBridge.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }
}

contract CrossChainBridgeTest {
    CrossChainBridge internal bridge;
    MockToken internal token;
    uint256 internal validatorPk = 0xA1;
    address internal validator;

    function setUp() public {
        validator = vm.addr(validatorPk);
        token = new MockToken();
        bridge = new CrossChainBridge(address(token), validator);
        token.approve(address(bridge), type(uint256).max);
        token.transfer(address(this), 0);
    }

    function _sign(bytes32 hash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPk, hash);
        return abi.encodePacked(r, s, v);
    }

    function test_EIP712DomainSeparator() public view {
        bytes32 expected = keccak256(abi.encode(
            bridge.EIP712_DOMAIN_TYPEHASH(),
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(bridge)
        ));
        assertEq(bridge.domainSeparator(), expected);
    }

    function test_PerSenderNonce() public {
        address sender1 = address(0xBEEF);
        address sender2 = address(0xCAFE);

        assertEq(bridge.senderNonces(sender1), 0);
        assertEq(bridge.senderNonces(sender2), 0);

        // Fund senders
        token.transfer(sender1, 1000);
        token.transfer(sender2, 1000);

        // Prank as sender1
        vm.startPrank(sender1);
        token.approve(address(bridge), type(uint256).max);
        bridge.initiateTransfer(100, 2);
        assertEq(bridge.senderNonces(sender1), 1);
        bridge.initiateTransfer(200, 2);
        assertEq(bridge.senderNonces(sender1), 2);
        vm.stopPrank();

        // Prank as sender2
        vm.startPrank(sender2);
        token.approve(address(bridge), type(uint256).max);
        bridge.initiateTransfer(50, 2);
        assertEq(bridge.senderNonces(sender2), 1);
        vm.stopPrank();
    }

    function test_ValidSignature_ProcessTransfer() public {
        address recipient = address(0x1234);
        uint256 amount = 500;
        uint256 nonce = 42;

        bytes32 hash = bridge.hashTransfer(recipient, amount, nonce);
        bytes memory sig = _sign(hash);

        uint256 balBefore = token.balanceOf(recipient);
        bridge.processTransfer(recipient, amount, nonce, sig);
        assertEq(token.balanceOf(recipient), balBefore + amount);
    }

    function testRevert_SameChainReplay() public {
        address recipient = address(0x1234);
        uint256 amount = 500;
        uint256 nonce = 42;

        bytes32 hash = bridge.hashTransfer(recipient, amount, nonce);
        bytes memory sig = _sign(hash);

        bridge.processTransfer(recipient, amount, nonce, sig);

        // Replay same transfer
        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, nonce, sig);
    }

    function testRevert_InvalidSignature() public {
        address recipient = address(0x1234);
        uint256 amount = 500;
        uint256 nonce = 42;

        // Sign with wrong key
        uint256 wrongPk = 0xB2;
        bytes32 hash = bridge.hashTransfer(recipient, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, hash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, nonce, sig);
    }

    function testRevert_EcrecoverZeroAddress() public {
        address recipient = address(0x1234);
        uint256 amount = 500;
        uint256 nonce = 42;

        // Craft signature that makes ecrecover return address(0)
        // v=0, r=0, s=0 causes ecrecover to return address(0)
        bytes memory sig = abi.encodePacked(bytes32(0), bytes32(0), uint8(0));

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, nonce, sig);
    }

    function test_CrossChainReplay_Prevented() public {
        // Simulate different chain by forking at different chainId
        address recipient = address(0x1234);
        uint256 amount = 500;
        uint256 nonce = 42;

        // Hash on chain 1
        bytes32 hash1 = bridge.hashTransfer(recipient, amount, nonce);
        bytes memory sig1 = _sign(hash1);
        bridge.processTransfer(recipient, amount, nonce, sig1);

        // Now simulate chain 2 — deploy new bridge
        vm.chainId(999);
        CrossChainBridge bridge2 = new CrossChainBridge(address(token), validator);

        // Same signature should not work on different chain
        bytes32 hash2 = bridge2.hashTransfer(recipient, amount, nonce);
        assertNotEq(hash1, hash2);

        // sig1 was for hash1 (chain 1), not hash2 (chain 2)
        vm.expectRevert("Invalid signature");
        bridge2.processTransfer(recipient, amount, nonce, sig1);
    }

    function test_PostUpgradeReplay_Prevented() public {
        address recipient = address(0x1234);
        uint256 amount = 500;
        uint256 nonce = 42;

        bytes32 hash1 = bridge.hashTransfer(recipient, amount, nonce);
        bytes memory sig1 = _sign(hash1);
        bridge.processTransfer(recipient, amount, nonce, sig1);

        // Deploy new bridge at different address (simulating upgrade)
        CrossChainBridge bridge2 = new CrossChainBridge(address(token), validator);

        // Hash includes contract address via domain separator
        bytes32 hash2 = bridge2.hashTransfer(recipient, amount, nonce);
        assertNotEq(hash1, hash2);

        // Same signature should not work on new contract
        vm.expectRevert("Invalid signature");
        bridge2.processTransfer(recipient, amount, nonce, sig1);
    }

    function test_NonceQueryable() public {
        address sender = address(0xBEEF);
        token.transfer(sender, 10000);
        vm.startPrank(sender);
        token.approve(address(bridge), type(uint256).max);
        bridge.initiateTransfer(100, 2);
        assertEq(bridge.senderNonces(sender), 1);
        bridge.initiateTransfer(200, 2);
        assertEq(bridge.senderNonces(sender), 2);
        vm.stopPrank();
    }
}
