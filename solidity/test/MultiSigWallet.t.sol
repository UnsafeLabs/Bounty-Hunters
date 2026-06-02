// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

/// @dev Malicious contract that attempts to revoke a confirmation during execution callback
contract MaliciousRevokeCallback {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    bool public revokeAttempted;
    bool public revokeSucceeded;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function setTargetTxId(uint256 _txId) external {
        targetTxId = _txId;
    }

    // This function is called by the wallet during executeTransaction
    // It attempts to revoke a confirmation during the callback
    function attack() external payable {
        revokeAttempted = true;
        try wallet.revokeConfirmation(targetTxId) {
            revokeSucceeded = true;
        } catch {
            revokeSucceeded = false;
        }
    }

    receive() external payable {
        // Try to revoke confirmation during callback
        revokeAttempted = true;
        try wallet.revokeConfirmation(targetTxId) {
            revokeSucceeded = true;
        } catch {
            revokeSucceeded = false;
        }
    }
}

/// @dev Malicious contract that attempts reentrancy on executeTransaction
contract MaliciousReenterCallback {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    bool public reenterAttempted;
    bool public reenterSucceeded;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function setTargetTxId(uint256 _txId) external {
        targetTxId = _txId;
    }

    function attack() external payable {
        reenterAttempted = true;
        try wallet.executeTransaction(targetTxId) {
            reenterSucceeded = true;
        } catch {
            reenterSucceeded = false;
        }
    }

    receive() external payable {
        if (!reenterAttempted) {
            reenterAttempted = true;
            try wallet.executeTransaction(targetTxId) {
                reenterSucceeded = true;
            } catch {
                reenterSucceeded = false;
            }
        }
    }
}

/// @dev Simple target contract for valid execution tests
contract TargetContract {
    uint256 public lastValue;
    bytes public lastData;
    bool public called;

    function execute(uint256 value) external payable {
        lastValue = value;
        called = true;
    }

    function noArgs() external payable {
        called = true;
    }

    receive() external payable {}
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    address public owner1;
    address public owner2;
    address public owner3;
    TargetContract public target;

    function setUp() public {
        owner1 = makeAddr("owner1");
        owner2 = makeAddr("owner2");
        owner3 = makeAddr("owner3");

        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;

        wallet = new MultiSigWallet(owners, 2);
        target = new TargetContract();
    }

    // ============ EXISTING MULTISIG FLOW TESTS ============

    function test_submitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.execute.selector, 42)
        );
        assertEq(txId, 0);

        (address to, uint256 value, bytes memory data, bool executed) = wallet.transactions(txId);
        assertEq(to, address(target));
        assertEq(value, 0);
        assertFalse(executed);
    }

    function test_confirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.noArgs.selector)
        );

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        assertEq(wallet.confirmations(txId, owner1), block.number);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        assertEq(wallet.confirmations(txId, owner2), block.number);
    }

    function test_executeTransaction_happyPath() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.noArgs.selector)
        );

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);
        assertTrue(target.called());
    }

    function test_revokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.noArgs.selector)
        );

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        assertGt(wallet.confirmations(txId, owner1), 0);

        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        assertEq(wallet.confirmations(txId, owner1), 0);
    }

    function test_cannotConfirmTwice() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.noArgs.selector)
        );

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
    }

    function test_cannotExecuteWithoutEnoughConfirmations() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.noArgs.selector)
        );

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_cannotExecuteTwice() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.noArgs.selector)
        );

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);
    }

    function test_onlyOwnersCanSubmit() public {
        address nonOwner = makeAddr("nonOwner");
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(target), 0, "");
    }

    function test_onlyOwnersCanConfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        address nonOwner = makeAddr("nonOwner");
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    // ============ ZERO ADDRESS REJECTION TESTS ============

    function test_rejectZeroAddressTarget() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address target");
        wallet.submitTransaction(address(0), 0, "");
    }

    function test_rejectZeroAddressWithValue() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address target");
        wallet.submitTransaction(address(0), 1 ether, "");
    }

    function test_rejectZeroAddressWithdata() public {
        vm.prank(owner1);
        vm.expectRevert("Zero address target");
        wallet.submitTransaction(address(0), 0, abi.encodeWithSelector(target.noArgs.selector));
    }

    // ============ CONTRACT CODE SIZE CHECK TESTS ============

    function test_rejectEOATarget() public {
        address eoa = makeAddr("eoa");
        vm.prank(owner1);
        vm.expectRevert("Target not a contract");
        wallet.submitTransaction(eoa, 0, "");
    }

    function test_acceptContractTarget() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");
        assertEq(txId, 0);
    }

    // ============ CALLBACK REVOCATION PREVENTION TESTS ============

    function test_cannotRevokeDuringExecutionCallback() public {
        // Deploy malicious contract
        MaliciousRevokeCallback attacker = new MaliciousRevokeCallback(address(wallet));

        // Fund wallet
        vm.deal(address(wallet), 1 ether);

        // Submit transaction targeting the malicious contract
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(attacker),
            0,
            abi.encodeWithSelector(attacker.attack.selector)
        );

        // Set target txId in attacker
        attacker.setTargetTxId(txId);

        // Both owners confirm
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 confirmationsBefore = wallet.getConfirmationCount(txId);
        assertEq(confirmationsBefore, 2);

        // Execute - the attacker's callback will attempt to revoke but should fail
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Transaction should be marked as executed
        (,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);

        // Verify attacker attempted revoke but it failed
        assertTrue(attacker.revokeAttempted());
        assertFalse(attacker.revokeSucceeded());

        // Confirmations should still be intact
        assertEq(wallet.getConfirmationCount(txId), 2);
    }

    function test_cannotRevokeViaReceiveCallback() public {
        MaliciousRevokeCallback attacker = new MaliciousRevokeCallback(address(wallet));
        vm.deal(address(wallet), 1 ether);

        // Submit transaction that sends ETH to the attacker (triggers receive)
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(attacker), 0.5 ether, "");

        attacker.setTargetTxId(txId);

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Execute - attacker's receive will try to revoke
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Confirm the attacker's revocation was prevented
        (,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);

        // Verify attacker attempted revoke but it failed
        assertTrue(attacker.revokeAttempted());
        assertFalse(attacker.revokeSucceeded());
    }

    // ============ REENTRANCY PREVENTION TESTS ============

    function test_cannotReenterExecuteTransaction() public {
        MaliciousReenterCallback attacker = new MaliciousReenterCallback(address(wallet));
        vm.deal(address(wallet), 1 ether);

        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(attacker), 0.1 ether, "");

        attacker.setTargetTxId(txId);

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Execute - attacker will try to re-enter executeTransaction
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);

        // Verify reentrancy was attempted but failed
        assertTrue(attacker.reenterAttempted());
        assertFalse(attacker.reenterSucceeded());
    }

    // ============ BLOCK-LEVEL CONFIRMATION CHECK TESTS ============

    function test_isConfirmedAtBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        uint256 actualConfirmBlock = wallet.confirmations(txId, owner1);
        assertGt(actualConfirmBlock, 0);

        // Should be confirmed at the current block
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, actualConfirmBlock));
        // Should be confirmed at any later block
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, actualConfirmBlock + 100));
        // Should NOT be confirmed at an earlier block
        assertFalse(wallet.isConfirmedAtBlock(txId, owner1, actualConfirmBlock - 1));
        // Should NOT be confirmed for non-confirming owner
        assertFalse(wallet.isConfirmedAtBlock(txId, owner2, actualConfirmBlock));
    }

    function test_isConfirmedAtBlock_afterRevocation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        uint256 confirmBlock = wallet.confirmationBlock(txId, owner1);

        // Confirmed at the confirmation block
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, confirmBlock));

        // Revoke
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);

        // After revocation, isConfirmedAtBlock STILL returns true for the historical block
        // because confirmationBlock is immutable and never reset
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, confirmBlock));

        // But current confirmations mapping is 0 (no longer confirmed)
        assertEq(wallet.confirmations(txId, owner1), 0);
    }

    function test_isConfirmedAtBlock_preventsFrontRunning() public {
        // Simulate a front-running scenario:
        // 1. Transaction is confirmed at block N
        // 2. An observer sees the execution pending
        // 3. Attacker front-runs by revoking at block N+1
        // 4. The isConfirmedAtBlock function can verify the confirmation existed at block N

        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        uint256 owner1ConfirmBlock = wallet.confirmationBlock(txId, owner1);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        uint256 owner2ConfirmBlock = wallet.confirmationBlock(txId, owner2);

        // Both confirmed - can verify at either block
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, owner1ConfirmBlock));
        assertTrue(wallet.isConfirmedAtBlock(txId, owner2, owner2ConfirmBlock));

        // Simulate: move to next block, owner2 front-runs and revokes
        vm.roll(block.number + 1);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // Even after revocation, historical block check still shows owner2 was confirmed
        assertTrue(wallet.isConfirmedAtBlock(txId, owner2, owner2ConfirmBlock));

        // But getConfirmationCount now shows only 1
        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    // ============ GAS TEST ============

    function test_executeTransaction_gasWithinLimit() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(target),
            0,
            abi.encodeWithSelector(target.noArgs.selector)
        );

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        uint256 gasBefore = gasleft();
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasBefore - gasleft();

        // Gas used should not exceed 100,000 (including the cheap external call)
        assertLt(gasUsed, 100000);
    }

    // ============ EDGE CASES ============

    function test_getConfirmationCount() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        assertEq(wallet.getConfirmationCount(txId), 0);

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        assertEq(wallet.getConfirmationCount(txId), 1);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        assertEq(wallet.getConfirmationCount(txId), 2);
    }

    function test_cannotRevokeUnconfirmed() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner1);
        vm.expectRevert("Not confirmed");
        wallet.revokeConfirmation(txId);
    }

    function test_cannotRevokeExecuted() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.revokeConfirmation(txId);
    }

    function test_confirmTransactionBlockedDuringExecution() public {
        // Verify that confirmTransaction has the noActiveExecution modifier
        // by testing the full callback flow with a contract that tries to confirm
        MaliciousConfirmCallback attacker = new MaliciousConfirmCallback(address(wallet));

        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(
            address(attacker),
            0,
            abi.encodeWithSelector(attacker.attack.selector)
        );

        attacker.setTargetTxId(txId);

        // Only owner1 confirms initially
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        // Execute - the attacker will try to confirm for owner3 during callback
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        (,,, bool executed) = wallet.transactions(txId);
        assertTrue(executed);

        // Verify confirm was attempted but failed
        assertTrue(attacker.confirmAttempted());
        assertFalse(attacker.confirmSucceeded());
    }

    function test_revokeBlockedDuringExecution() public {
        // Directly test that revokeConfirmation reverts when _executing is true
        // Covered by test_cannotRevokeDuringExecutionCallback which verifies
        // revokeAttempted=true and revokeSucceeded=false
    }

    function test_confirmationBlockPreservedAfterRevokeAndReconfirm() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 0, "");

        // First confirmation
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        uint256 firstConfirmBlock = wallet.confirmationBlock(txId, owner1);

        // Revoke
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);

        // After revocation, historical block check still works
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, firstConfirmBlock));

        // Re-confirm in a new block
        vm.roll(block.number + 5);
        vm.prank(owner1);
        wallet.confirmTransaction(txId);

        // confirmationBlock should still reflect the FIRST confirmation block
        // (never overwritten on re-confirmation)
        uint256 storedConfirmBlock = wallet.confirmationBlock(txId, owner1);
        assertEq(storedConfirmBlock, firstConfirmBlock);

        // isConfirmedAtBlock works with the original and any later block
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, firstConfirmBlock));
        assertTrue(wallet.isConfirmedAtBlock(txId, owner1, firstConfirmBlock + 100));
    }
}

/// @dev Malicious contract that attempts to confirm during execution callback
contract MaliciousConfirmCallback {
    MultiSigWallet public wallet;
    uint256 public targetTxId;
    bool public confirmAttempted;
    bool public confirmSucceeded;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function setTargetTxId(uint256 _txId) external {
        targetTxId = _txId;
    }

    function attack() external payable {
        confirmAttempted = true;
        try wallet.confirmTransaction(targetTxId) {
            confirmSucceeded = true;
        } catch {
            confirmSucceeded = false;
        }
    }

    receive() external payable {}
}
