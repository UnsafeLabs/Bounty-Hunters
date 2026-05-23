// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CrossChainBridgeTest is Test {
    using ECDSA for bytes32;

    CrossChainBridge public bridge;
    uint256 public signerKey;
    address public signer;
    address public user = address(0x1);
    address public attacker = address(0x2);

    function setUp() public {
        signerKey = 0xdeadbeef;
        signer = vm.addr(signerKey);
        bridge = new CrossChainBridge(signer);
    }

    function _signUnlock(address user_, uint256 amount_, uint256 nonce_, bytes32 txId_) internal view returns (bytes memory) {
        bytes32 digest = bridge._hashUnlock(user_, amount_, nonce_, txId_);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_Lock() public {
        bytes32 txId = keccak256("tx1");
        vm.prank(user);
        bridge.lock(100, txId);

        assertEq(bridge.nonces(user), 1);
    }

    function test_UnlockWithValidSignature() public {
        bytes32 txId = keccak256("tx1");
        bytes memory sig = _signUnlock(user, 100, 0, txId);

        bridge.unlock(user, 100, 0, txId, sig);

        assertEq(bridge.nonces(user), 1);
        assertTrue(bridge.processedHashes(txId));
    }

    function test_UnlockCannotBeReplayedOnDifferentChain() public {
        bytes32 txId = keccak256("tx1");
        bytes memory sig = _signUnlock(user, 100, 0, txId);

        vm.chainId(31338);
        vm.expectRevert("Invalid signature");
        bridge.unlock(user, 100, 0, txId, sig);
    }

    function test_UnlockCannotBeReplayedOnDifferentContract() public {
        CrossChainBridge otherBridge = new CrossChainBridge(signer);

        bytes32 txId = keccak256("tx1");
        bytes memory sig = _signUnlock(user, 100, 0, txId);

        vm.expectRevert("Invalid signature");
        otherBridge.unlock(user, 100, 0, txId, sig);
    }

    function test_ReplayAttackBlocked() public {
        bytes32 txId = keccak256("tx1");
        bytes memory sig = _signUnlock(user, 100, 0, txId);

        bridge.unlock(user, 100, 0, txId, sig);

        vm.expectRevert("Already processed");
        bridge.unlock(user, 100, 0, txId, sig);
    }

    function test_WrongNonceFails() public {
        bytes32 txId = keccak256("tx1");
        bytes memory sig = _signUnlock(user, 100, 5, txId);

        vm.expectRevert("Invalid nonce");
        bridge.unlock(user, 100, 5, txId, sig);
    }

    function test_NonSequentialNonceFails() public {
        bytes32 txId = keccak256("tx1");
        vm.prank(user);
        bridge.lock(100, txId);

        bytes memory sig = _signUnlock(user, 100, 0, txId);

        vm.expectRevert("Invalid nonce");
        bridge.unlock(user, 100, 0, txId, sig);
    }

    function test_InvalidSignatureFails() public {
        bytes32 txId = keccak256("tx1");
        bytes memory sig = _signUnlock(user, 100, 0, txId);

        bridge = new CrossChainBridge(address(0x999));

        vm.expectRevert("Invalid signature");
        bridge.unlock(user, 100, 0, txId, sig);
    }

    function test_EIP712DomainSeparator() public {
        bytes32 separator = bridge.DOMAIN_SEPARATOR();
        bytes32 expected = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            block.chainid,
            address(bridge)
        ));
        assertEq(separator, expected);
    }

    function test_LockRejectsZeroAmount() public {
        vm.prank(user);
        vm.expectRevert("Invalid amount");
        bridge.lock(0, keccak256("tx1"));
    }

    function test_UnlockRejectsZeroUser() public {
        bytes32 txId = keccak256("tx1");
        vm.expectRevert("Invalid user");
        bridge.unlock(address(0), 100, 0, txId, "");
    }

    function test_UnlockRejectsZeroAmount() public {
        bytes32 txId = keccak256("tx1");
        vm.expectRevert("Invalid amount");
        bridge.unlock(user, 0, 0, txId, "");
    }

    function test_UnlockRejectsZeroTxId() public {
        vm.expectRevert("Invalid txId");
        bridge.unlock(user, 100, 0, bytes32(0), "");
    }

    function test_LockRejectsZeroTxId() public {
        vm.prank(user);
        vm.expectRevert("Invalid txId");
        bridge.lock(100, bytes32(0));
    }
}
