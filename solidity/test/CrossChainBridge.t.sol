// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Bridge", "BRG") {
        _mint(msg.sender, 1_000_000e18);
    }
}

contract CrossChainBridgeTest is Test {
    TestToken public token;
    CrossChainBridge public bridge;
    address public validator;
    uint256 public validatorKey;

    address public user = address(0x123);
    address public recipient = address(0x456);

    bytes32 constant TRANSFER_TYPEHASH = keccak256(
        "Transfer(address recipient,uint256 amount,uint256 nonce,uint256 chainId,address contractAddress)"
    );

    function setUp() public {
        validatorKey = 0xDEADBEEF;
        validator = vm.addr(validatorKey);

        token = new TestToken();
        bridge = new CrossChainBridge(address(token), validator);

        token.transfer(user, 100_000e18);
        vm.prank(user);
        token.approve(address(bridge), type(uint256).max);
    }

    function _buildDigest(address _recipient, uint256 amount, uint256 nonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            _recipient,
            amount,
            nonce,
            block.chainid,
            address(bridge)
        ));

        bytes32 domainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));

        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function test_ProcessValidTransfer() public {
        vm.prank(user);
        bridge.initiateTransfer(1000e18, 1);

        bytes32 digest = _buildDigest(recipient, 1000e18, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        bridge.processTransfer(recipient, 1000e18, 1, signature);

        assertEq(token.balanceOf(recipient), 1000e18);
    }

    function test_CrossChainReplayPrevention() public {
        vm.prank(user);
        bridge.initiateTransfer(1000e18, 1);

        bytes32 digest = _buildDigest(recipient, 1000e18, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        bridge.processTransfer(recipient, 1000e18, 1, signature);

        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, 1000e18, 1, signature);
    }

    function test_InvalidSignatureRejected() public {
        vm.prank(user);
        bridge.initiateTransfer(1000e18, 1);

        bytes32 digest = _buildDigest(recipient, 1000e18, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey + 1, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, 1000e18, 1, signature);
    }

    function test_ChainIdIncludedInDomainSeparator() public {
        bytes32 actualSep = bridge.domainSeparator();
        bytes32 expectedSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));
        assertEq(actualSep, expectedSep, "Domain separator should include chain ID");
    }

    function test_DifferentContractAddressRejected() public {
        CrossChainBridge otherBridge = new CrossChainBridge(address(token), validator);

        bytes32 digest = _buildDigest(recipient, 1000e18, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        otherBridge.processTransfer(recipient, 1000e18, 1, signature);
    }

    function test_NonceTracking() public {
        assertEq(bridge.getNonce(user), 0);
        vm.prank(user);
        bridge.initiateTransfer(1000e18, 1);
        assertEq(bridge.getNonce(user), 1);
    }

    function test_SenderNonceIncrementsOnEachTransfer() public {
        vm.startPrank(user);
        bridge.initiateTransfer(100e18, 1);
        bridge.initiateTransfer(200e18, 2);
        bridge.initiateTransfer(300e18, 3);
        vm.stopPrank();

        assertEq(bridge.getNonce(user), 3);
    }

    function test_ZeroAddressRecipientRejected() public {
        bytes32 digest = _buildDigest(address(0), 1000e18, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid recipient");
        bridge.processTransfer(address(0), 1000e18, 1, signature);
    }

    function test_EIP712DomainSeparator() public {
        bytes32 separator = bridge.domainSeparator();
        assertTrue(separator != bytes32(0));
    }

    function test_GetPoolBalance() public {
        vm.prank(user);
        bridge.initiateTransfer(1000e18, 1);

        assertEq(bridge.getPoolBalance(), 1000e18);
    }
}
