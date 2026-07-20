// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";

contract CrossChainBridgeTest is Test {
    CrossChainBridge bridge;
    address validator = address(0x1);
    address recipient = address(0x2);

    function setUp() public {
        bridge = new CrossChainBridge(address(0x3), validator);
    }

    function testTransferHashIncludesChainId() public {
        bytes32 hash1 = keccak256(abi.encodePacked(
            recipient,
            uint256(100),
            uint256(0),
            block.chainid,
            address(bridge)
        ));

        vm.chainId(999);
        bytes32 hash2 = keccak256(abi.encodePacked(
            recipient,
            uint256(100),
            uint256(0),
            block.chainid,
            address(bridge)
        ));

        assertFalse(hash1 == hash2, "Hashes should differ across chains");
    }

    function testTransferHashIncludesContractAddress() public {
        bytes32 hash1 = keccak256(abi.encodePacked(
            recipient,
            uint256(100),
            uint256(0),
            block.chainid,
            address(bridge)
        ));

        bytes32 hash2 = keccak256(abi.encodePacked(
            recipient,
            uint256(100),
            uint256(0),
            block.chainid,
            address(0x9999)
        ));

        assertFalse(hash1 == hash2, "Hashes should differ by contract address");
    }

    function testEcrecoverZeroAddressRejected() public {
        bytes memory invalidSig = new bytes(65);
        vm.expectRevert("Invalid signature: zero address");
        bridge.verifySignature(bytes32(uint256(1)), invalidSig);
    }

    function testSenderNonceQueryable() public {
        assertEq(bridge.getSenderNonce(recipient), 0);
    }
}
