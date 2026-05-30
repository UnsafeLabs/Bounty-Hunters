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
    CrossChainBridge bridge;
    MockERC20 token;

    uint256 validatorPrivKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address validator;
    address recipient = address(0xBEEF);

    function setUp() public {
        validator = vm.addr(validatorPrivKey);
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);
        token.transfer(address(bridge), 100 ether);
    }

    function _sign(address _recipient, uint256 amount, uint256 nonce) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)"),
            _recipient,
            amount,
            nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function testValidTransfer() public {
        bytes memory sig = _sign(recipient, 1 ether, 0);
        bridge.processTransfer(recipient, 1 ether, 0, sig);
        assertEq(token.balanceOf(recipient), 1 ether);
        assertEq(bridge.senderNonces(recipient), 1);
    }

    function testCrossChainReplay() public {
        // Craft a digest as if it came from a different chain (different DOMAIN_SEPARATOR)
        bytes32 fakeDomain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid + 1, // different chain
            address(bridge)
        ));
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)"),
            recipient,
            1 ether,
            0
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", fakeDomain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, 1 ether, 0, sig);
    }

    function testSameChainReplay() public {
        bytes memory sig = _sign(recipient, 1 ether, 0);
        bridge.processTransfer(recipient, 1 ether, 0, sig);
        // Second call with same nonce should revert
        bytes memory sig2 = _sign(recipient, 1 ether, 0);
        vm.expectRevert("Invalid nonce");
        bridge.processTransfer(recipient, 1 ether, 0, sig2);
    }

    function testPostUpgradeReplay() public {
        // Simulate replay against a different contract address (different verifyingContract in domain)
        bytes32 fakeDomain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(0xDEAD) // different contract address (post-upgrade proxy)
        ));
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)"),
            recipient,
            1 ether,
            0
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", fakeDomain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, 1 ether, 0, sig);
    }

    function testInvalidSignature() public {
        uint256 wrongKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)"),
            recipient,
            1 ether,
            0
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, 1 ether, 0, sig);
    }

    function testNonceIncrementsPerSender() public {
        bytes memory sig0 = _sign(recipient, 1 ether, 0);
        bridge.processTransfer(recipient, 1 ether, 0, sig0);
        assertEq(bridge.senderNonces(recipient), 1);

        token.transfer(address(bridge), 1 ether);
        bytes memory sig1 = _sign(recipient, 1 ether, 1);
        bridge.processTransfer(recipient, 1 ether, 1, sig1);
        assertEq(bridge.senderNonces(recipient), 2);
    }

    function testEIP712DomainSeparator() public view {
        bytes32 expected = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(bridge)
        ));
        assertEq(bridge.DOMAIN_SEPARATOR(), expected);
    }

    function testZeroAddressEcrecoverRejected() public {
        // Provide a signature that would cause ecrecover to return address(0)
        // This is achieved with a crafted invalid signature (all zeros in r,s)
        bytes memory badSig = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));
        vm.expectRevert();
        bridge.processTransfer(recipient, 1 ether, 0, badSig);
    }
}
