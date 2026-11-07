// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/CrossChainBridge.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 1000000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockToken public token;
    address public validator;
    address public user1;
    address public user2;
    uint256 public validatorKey;

    function setUp() public {
        validatorKey = 0x1234;
        validator = vm.addr(validatorKey);
        user1 = address(0x1);
        user2 = address(0x2);

        token = new MockToken();
        bridge = new CrossChainBridge(address(token), validator);

        // Mint tokens to users
        token.mint(user1, 10000 * 10**18);
        token.mint(user2, 10000 * 10**18);

        // Fund the bridge
        token.mint(address(bridge), 100000 * 10**18);
    }

    function testDomainSeparatorInitialization() public view {
        bytes32 expectedDomainSeparator = keccak256(
            abi.encode(
                bridge.DOMAIN_TYPEHASH(),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(bridge)
            )
        );
        assertEq(bridge.DOMAIN_SEPARATOR(), expectedDomainSeparator);
    }

    function testInitiateTransfer() public {
        uint256 amount = 1000 * 10**18;
        uint256 targetChain = 1;

        vm.startPrank(user1);
        token.approve(address(bridge), amount);
        bridge.initiateTransfer(amount, targetChain);
        vm.stopPrank();

        assertEq(token.balanceOf(address(bridge)), 101000 * 10**18);
    }

    function testProcessTransferWithValidSignature() public {
        address sender = user1;
        address recipient = user2;
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 0;

        // Construct EIP-712 typed data
        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                transferNonce,
                sender
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        // Sign the digest
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        uint256 recipientBalanceBefore = token.balanceOf(recipient);

        bridge.processTransfer(sender, recipient, amount, transferNonce, signature);

        uint256 recipientBalanceAfter = token.balanceOf(recipient);
        assertEq(recipientBalanceAfter - recipientBalanceBefore, amount);
        assertEq(bridge.senderNonces(sender), 1);
    }

    function testRevertOnCrossChainReplay() public {
        address sender = user1;
        address recipient = user2;
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 0;

        // Construct signature for chain ID 1
        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                transferNonce,
                sender
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Process on current chain
        bridge.processTransfer(sender, recipient, amount, transferNonce, signature);

        // Simulate different chain by changing chain ID
        vm.chainId(999);
        
        // Create new bridge on different chain
        CrossChainBridge bridge2 = new CrossChainBridge(address(token), validator);
        token.mint(address(bridge2), 100000 * 10**18);

        // Try to replay same signature - should fail because DOMAIN_SEPARATOR is different
        vm.expectRevert("Invalid signature");
        bridge2.processTransfer(sender, recipient, amount, transferNonce, signature);
    }

    function testRevertOnSameChainReplay() public {
        address sender = user1;
        address recipient = user2;
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 0;

        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                transferNonce,
                sender
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // First transfer succeeds
        bridge.processTransfer(sender, recipient, amount, transferNonce, signature);

        // Try to replay same transfer - should fail because nonce incremented
        vm.expectRevert("Invalid nonce");
        bridge.processTransfer(sender, recipient, amount, transferNonce, signature);
    }

    function testRevertOnInvalidNonce() public {
        address sender = user1;
        address recipient = user2;
        uint256 amount = 100 * 10**18;
        uint256 invalidNonce = 999; // Wrong nonce

        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                invalidNonce,
                sender
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid nonce");
        bridge.processTransfer(sender, recipient, amount, invalidNonce, signature);
    }

    function testRevertOnInvalidSignature() public {
        address sender = user1;
        address recipient = user2;
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 0;

        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                transferNonce,
                sender
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        // Sign with wrong key
        uint256 wrongKey = 0x5678;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(sender, recipient, amount, transferNonce, signature);
    }

    function testRevertOnZeroAddressRecovery() public {
        bytes32 hash = keccak256("test");
        
        // Create invalid signature that will result in zero address
        bytes memory invalidSignature = new bytes(65);
        for (uint i = 0; i < 65; i++) {
            invalidSignature[i] = 0x00;
        }

        vm.expectRevert("Invalid signature recovery");
        bridge.verifySignature(hash, invalidSignature);
    }

    function testGetSenderNonce() public {
        assertEq(bridge.getSenderNonce(user1), 0);
        assertEq(bridge.getSenderNonce(user2), 0);

        // Process a transfer
        address sender = user1;
        address recipient = user2;
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 0;

        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                transferNonce,
                sender
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        bridge.processTransfer(sender, recipient, amount, transferNonce, signature);

        assertEq(bridge.getSenderNonce(user1), 1);
    }

    function testMultipleTransfersFromSameSender() public {
        address sender = user1;
        address recipient = user2;

        // First transfer
        uint256 amount1 = 100 * 10**18;
        uint256 nonce1 = 0;

        bytes32 structHash1 = keccak256(
            abi.encode(bridge.TRANSFER_TYPEHASH(), recipient, amount1, nonce1, sender)
        );
        bytes32 digest1 = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash1)
        );
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(validatorKey, digest1);
        bytes memory signature1 = abi.encodePacked(r1, s1, v1);

        bridge.processTransfer(sender, recipient, amount1, nonce1, signature1);
        assertEq(bridge.getSenderNonce(sender), 1);

        // Second transfer
        uint256 amount2 = 200 * 10**18;
        uint256 nonce2 = 1;

        bytes32 structHash2 = keccak256(
            abi.encode(bridge.TRANSFER_TYPEHASH(), recipient, amount2, nonce2, sender)
        );
        bytes32 digest2 = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash2)
        );
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(validatorKey, digest2);
        bytes memory signature2 = abi.encodePacked(r2, s2, v2);

        bridge.processTransfer(sender, recipient, amount2, nonce2, signature2);
        assertEq(bridge.getSenderNonce(sender), 2);

        assertEq(token.balanceOf(recipient), amount1 + amount2);
    }

    function testRevertOnContractUpgradeReplay() public {
        address sender = user1;
        address recipient = user2;
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 0;

        // Create signature for current contract
        bytes32 structHash = keccak256(
            abi.encode(bridge.TRANSFER_TYPEHASH(), recipient, amount, transferNonce, sender)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Deploy new contract instance (simulating upgrade)
        CrossChainBridge newBridge = new CrossChainBridge(address(token), validator);
        token.mint(address(newBridge), 100000 * 10**18);

        // Try to replay signature on new contract - should fail
        vm.expectRevert("Invalid signature");
        newBridge.processTransfer(sender, recipient, amount, transferNonce, signature);
    }
}
