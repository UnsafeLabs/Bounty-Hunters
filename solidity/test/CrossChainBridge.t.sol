// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/CrossChainBridge.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 1000000 * 10**18);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockERC20 public token;
    address public validator;
    uint256 public validatorKey;
    address public user;
    uint256 public userKey;

    function setUp() public {
        validatorKey = 0x1234;
        validator = vm.addr(validatorKey);
        
        userKey = 0x5678;
        user = vm.addr(userKey);

        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);

        // Fund users
        token.transfer(user, 10000 * 10**18);
        
        // Approve bridge
        vm.prank(user);
        token.approve(address(bridge), type(uint256).max);
    }

    function testInitiateTransfer() public {
        vm.prank(user);
        bridge.initiateTransfer(100 * 10**18, 1);

        assertEq(token.balanceOf(address(bridge)), 100 * 10**18);
    }

    function testProcessTransferWithEIP712() public {
        address recipient = address(0x999);
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 1;

        // Create EIP-712 structured data hash
        bytes32 structHash = keccak256(abi.encode(
            bridge.TRANSFER_TYPEHASH(),
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(bridge)
        ));

        bytes32 digest = bridge.hashTypedDataV4(structHash);

        // Sign with validator
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Process transfer
        bridge.processTransfer(recipient, amount, transferNonce, signature);

        assertEq(token.balanceOf(recipient), amount);
    }

    function testRevertOnCrossChainReplay() public {
        address recipient = address(0x999);
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 1;

        // Create hash for chain ID 1
        bytes32 structHash = keccak256(abi.encode(
            bridge.TRANSFER_TYPEHASH(),
            recipient,
            amount,
            transferNonce,
            1, // Different chain ID
            address(bridge)
        ));

        bytes32 digest = bridge.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Should revert because chain ID doesn't match
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, transferNonce, signature);
    }

    function testRevertOnSameChainReplay() public {
        address recipient = address(0x999);
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 1;

        bytes32 structHash = keccak256(abi.encode(
            bridge.TRANSFER_TYPEHASH(),
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(bridge)
        ));

        bytes32 digest = bridge.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // First process should succeed
        bridge.processTransfer(recipient, amount, transferNonce, signature);

        // Second process should revert (already processed)
        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, transferNonce, signature);
    }

    function testRevertOnZeroAddressSignature() public {
        address recipient = address(0x999);
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 1;

        bytes32 structHash = keccak256(abi.encode(
            bridge.TRANSFER_TYPEHASH(),
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(bridge)
        ));

        bytes32 digest = bridge.hashTypedDataV4(structHash);

        // Create invalid signature (all zeros)
        bytes memory invalidSignature = new bytes(65);

        vm.expectRevert("Invalid signature: zero address");
        bridge.processTransfer(recipient, amount, transferNonce, invalidSignature);
    }

    function testRevertOnInvalidSignatureLength() public {
        address recipient = address(0x999);
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 1;

        bytes memory shortSignature = new bytes(64);

        vm.expectRevert("Invalid signature length");
        bridge.processTransfer(recipient, amount, transferNonce, shortSignature);
    }

    function testDomainSeparator() public view {
        bytes32 expectedSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));

        assertEq(bridge.domainSeparator(), expectedSeparator);
    }

    function testSenderNonceQueryable() public {
        assertEq(bridge.getSenderNonce(user), 0);
    }

    function testRevertOnContractAddressMismatch() public {
        // Deploy another bridge
        CrossChainBridge anotherBridge = new CrossChainBridge(address(token), validator);

        address recipient = address(0x999);
        uint256 amount = 100 * 10**18;
        uint256 transferNonce = 1;

        // Create hash with different contract address
        bytes32 structHash = keccak256(abi.encode(
            bridge.TRANSFER_TYPEHASH(),
            recipient,
            amount,
            transferNonce,
            block.chainid,
            address(anotherBridge) // Wrong contract address
        ));

        bytes32 digest = bridge.hashTypedDataV4(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Should revert because contract address doesn't match
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, transferNonce, signature);
    }
}
