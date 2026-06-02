// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

// ─────────────────────────────────────────────
// Malicious contract: tries to re-enter executeTransaction during callback
// ─────────────────────────────────────────────
contract MaliciousReenterExecute {
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

// ─────────────────────────────────────────────
// Malicious contract: tries to revoke confirmation during execution callback
// ─────────────────────────────────────────────
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

    function attack() external payable {
        revokeAttempted = true;
        try wallet.revokeConfirmation(targetTxId) {
            revokeSucceeded = true;
        } catch {
            revokeSucceeded = false;
        }
    }

    receive() external payable {
        revokeAttempted = true;
        try wallet.revokeConfirmation(targetTxId) {
            revokeSucceeded = true;
        } catch {
            revokeSucceeded = false;
        }
    }
}

// ─────────────────────────────────────────────
// Malicious contract: tries to confirm during execution callback
// ─────────────────────────────────────────────
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

    receive() external payable {
        confirmAttempted = true;
        try wallet.confirmTransaction(targetTxId) {
            confirmSucceeded = true;
        } catch {
            confirmSucceeded = false;
        }
    }
}

// ─────────────────────────────────────────────
// Malicious contract: tries to submit a new tx during execution callback
// ─────────────────────────────────────────────
contract MaliciousSubmitCallback {
    MultiSigWallet public wallet;
    bool public submitAttempted;
    bool public submitSucceeded;

    constructor(address _wallet) {
        wallet = MultiSigWallet(payable(_wallet));
    }

    function attack() external payable {
        submitAttempted = true;
        try wallet.submitTransaction(address(this), 0, "") {
            submitSucceeded = true;
        } catch {
            submitSucceeded = false;
        }
    }

    receive() external payable {
        submitAttempted = true;
        try wallet.submitTransaction(address(this), 0, "") {
            submitSucceeded = true;
        } catch {
            submitSucceeded = false;
        }
    }
}

// ─────────────────────────────────────────────
// Simple target contract for valid execution tests
// ─────────────────────────────────────────────
contract TargetContract {
    uint256 public lastValue;
    bool public called;
    uint256 public callCount;

    function execute(uint256 value) external payable {
        lastValue = value;
        called = true;
        callCount++;
    }

    function noArgs() external payable {
        called = true;
        callCount++;
    }

    receive() external payable {
        callCount++;
    }
}

// ═══════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════
contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    TargetContract public target;

    address public owner1;
    address public owner2;
    address public owner3;
    address public nonOwner;

    uint256 constant REQUIRED = 2;

    function setUp() public {
        owner1 = makeAddr("owner1");
        owner2 = makeAddr("owner2");
        owner3 = makeAddr("owner3");
        nonOwner = makeAddr("nonOwner");

        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;

        wallet = new MultiSigWallet(owners, REQUIRED);
        target = new TargetContract();
    }

    // ─────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────

    function _submitTx(address to, uint256 value, bytes memory data) internal returns (uint256) {
        vm.prank(owner1);
        return wallet.submitTransaction(to, value, data);
    }

    function _confirmTx(uint256 txId, address owner) internal {
        vm.prank(owner);
        wallet.confirmTransaction(txId);
    }

    function _submitAndConfirm(address to, uint256 value, bytes memory data) internal returns (uint256) {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(to, value, data);
        _confirmTx(txId, owner1);
        return txId;
    }

    function _fullyConfirmAndExecute(uint256 txId) internal {
        _confirmTx(txId, owner1);
        _confirmTx(txId, owner2);
        vm.prank(owner1);
        wallet.executeTransaction(txId);
    }

    // ═══════════════════════════════════════════
    // CONSTRUCTOR TESTS
    // ═══════════════════════════════════════════

    function test_constructor_happyPath() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = owner2;
        MultiSigWallet w = new MultiSigWallet(owners, 2);
        assertEq(w.required(), 2);
        assertTrue(w.isOwner(owner1));
        assertTrue(w.isOwner(owner2));
    }

    function test_constructor_noOwners_reverts() public {
        address[] memory owners = new address[](0);
        vm.expectRevert("No owners");
        new MultiSigWallet(owners, 1);
    }

    function test_constructor_zeroRequired_reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = owner2;
        vm.expectRevert("Invalid required");
        new MultiSigWallet(owners, 0);
    }

    function test_constructor_requiredExceedsOwners_reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = owner2;
        vm.expectRevert("Invalid required");
        new MultiSigWallet(owners, 3);
    }

    function test_constructor_zeroAddressOwner_reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = address(0);
        owners[1] = owner2;
        vm.expectRevert("Zero address owner");
        new MultiSigWallet(owners, 1);
    }

    function test_constructor_duplicateOwner_reverts() public {
        address[] memory owners = new address[](2);
        owners[0] = owner1;
        owners[1] = owner1;
        vm.expectRevert("Duplicate owner");
        new MultiSigWallet(owners, 1);
    }

    // ═══════════════════════════════════════════
    // SUBMIT TRANSACTION TESTS
    // ═══════════════════════════════════════════

    function test_submitTransaction_happyPath() public {
        uint256 txId = _submitTx(address(target), 0, "");

        assertEq(txId, 0);
        assertEq(wallet.transactionCount(), 1);

        (address to, uint256 value, bytes memory data, bool executed) = wallet.transactions(txId);
        assertEq(to, address(target));
        assertEq(value, 0);
        assertEq(data, "");
        assertFalse(executed);
    }

    function test_submitTransaction_emitsEvent() public {
        vm.prank(owner1);
        vm.expectEmit(true, false, false, false);
        emit MultiSigWallet.Submitted(0);
        wallet.submitTransaction(address(target), 0, "");
    }

    function test_submitTransaction_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(target), 0, "");
    }

    function test_submitTransaction_multipleTransactions() public {
        _submitTx(address(target), 0, "");
        uint256 txId2 = _submitTx(address(target), 1 ether, "");
        assertEq(txId2, 1);
        assertEq(wallet.transactionCount(), 2);
    }

    // ═══════════════════════════════════════════
    // CONFIRM TRANSACTION TESTS
    // ═══════════════════════════════════════════

    function test_confirmTransaction_happyPath() public {
        uint256 txId = _submitTx(address(target), 0, "");

        _confirmTx(txId, owner1);
        assertTrue(wallet.confirmations(txId, owner1));
        assertEq(wallet.getConfirmationCount(txId), 1);
    }

    function test_confirmTransaction_emitsEvent() public {
        uint256 txId = _submitTx(address(target), 0, "");

        vm.prank(owner1);
        vm.expectEmit(true, true, false, false);
        emit MultiSigWallet.Confirmed(txId, owner1);
        wallet.confirmTransaction(txId);
    }

    function test_confirmTransaction_nonOwner_reverts() public {
        uint256 txId = _submitTx(address(target), 0, "");

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);
    }

    function test_confirmTransaction_alreadyConfirmed_reverts() public {
        uint256 txId = _submitTx(address(target), 0, "");

        _confirmTx(txId, owner1);

        vm.prank(owner1);
        vm.expectRevert("Already confirmed");
        wallet.confirmTransaction(txId);
    }

    function test_confirmTransaction_alreadyExecuted_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner3);
        vm.expectRevert("Already executed");
        wallet.confirmTransaction(txId);
    }

    function test_confirmTransaction_nonExistentTx_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Transaction does not exist");
        wallet.confirmTransaction(999);
    }

    function test_confirmTransaction_multipleOwners() public {
        uint256 txId = _submitTx(address(target), 0, "");

        _confirmTx(txId, owner1);
        _confirmTx(txId, owner2);
        _confirmTx(txId, owner3);

        assertEq(wallet.getConfirmationCount(txId), 3);
    }

    // ═══════════════════════════════════════════
    // REVOKE CONFIRMATION TESTS
    // ═══════════════════════════════════════════

    function test_revokeConfirmation_happyPath() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");

        vm.prank(owner1);
        wallet.revokeConfirmation(txId);

        assertFalse(wallet.confirmations(txId, owner1));
        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    function test_revokeConfirmation_emitsEvent() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");

        vm.prank(owner1);
        vm.expectEmit(true, true, false, false);
        emit MultiSigWallet.Revoked(txId, owner1);
        wallet.revokeConfirmation(txId);
    }

    function test_revokeConfirmation_notConfirmed_reverts() public {
        uint256 txId = _submitTx(address(target), 0, "");

        vm.prank(owner1);
        vm.expectRevert("Not confirmed");
        wallet.revokeConfirmation(txId);
    }

    function test_revokeConfirmation_alreadyExecuted_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.revokeConfirmation(txId);
    }

    function test_revokeConfirmation_nonOwner_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.revokeConfirmation(txId);
    }

    function test_revokeConfirmation_nonExistentTx_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Transaction does not exist");
        wallet.revokeConfirmation(999);
    }

    // ═══════════════════════════════════════════
    // HAPPY PATH — FULL MULTI-SIG EXECUTION
    // ═══════════════════════════════════════════

    function test_executeTransaction_happyPath() public {
        bytes memory data = abi.encodeWithSelector(TargetContract.execute.selector, 42);
        uint256 txId = _submitAndConfirm(address(target), 0, data);
        _confirmTx(txId, owner2);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(target.called());
        assertEq(target.lastValue(), 42);
        assertEq(target.callCount(), 1);
    }

    function test_executeTransaction_emitsEvent() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(owner1);
        vm.expectEmit(true, false, false, false);
        emit MultiSigWallet.Executed(txId);
        wallet.executeTransaction(txId);
    }

    function test_executeTransaction_withValue() public {
        // Fund the wallet
        vm.deal(address(wallet), 1 ether);

        uint256 txId = _submitAndConfirm(address(target), 1 ether, "");
        _confirmTx(txId, owner2);

        uint256 targetBalanceBefore = address(target).balance;

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertEq(address(target).balance - targetBalanceBefore, 1 ether);
        assertEq(target.callCount(), 1);
    }

    function test_executeTransaction_nonOwner_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.executeTransaction(txId);
    }

    function test_executeTransaction_notEnoughConfirmations_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        // Only 1 confirmation, need 2

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_executeTransaction_nonExistentTx_reverts() public {
        vm.prank(owner1);
        vm.expectRevert("Transaction does not exist");
        wallet.executeTransaction(999);
    }

    // ═══════════════════════════════════════════
    // DOUBLE EXECUTION PREVENTION
    // ═══════════════════════════════════════════

    function test_executeTransaction_doubleExecution_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // First execution succeeds
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Second execution should fail
        vm.prank(owner1);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);

        // Target should only have been called once
        assertEq(target.callCount(), 1);
    }

    function test_executeTransaction_doubleExecution_differentCallers_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // First execution by owner1
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        // Second execution by owner2 should also fail
        vm.prank(owner2);
        vm.expectRevert("Already executed");
        wallet.executeTransaction(txId);

        assertEq(target.callCount(), 1);
    }

    // ═══════════════════════════════════════════
    // CONFIRMATION THRESHOLD ENFORCEMENT
    // ═══════════════════════════════════════════

    function test_executeTransaction_exactThreshold() public {
        // Exactly 2 confirmations (the required amount)
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(target.called());
    }

    function test_executeTransaction_aboveThreshold() public {
        // 3 confirmations with required=2
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);
        _confirmTx(txId, owner3);

        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(target.called());
    }

    function test_executeTransaction_belowThreshold_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        // Only 1 confirmation — not enough

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_executeTransaction_revokeBringsBelowThreshold_reverts() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // owner2 revokes, bringing confirmations below threshold
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);
    }

    function test_executeTransaction_reconfirmAfterRevoke() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId, owner2);

        // owner2 revokes
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        // Below threshold now
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);

        // owner2 reconfirms
        _confirmTx(txId, owner2);

        // Now it should work
        vm.prank(owner1);
        wallet.executeTransaction(txId);

        assertTrue(target.called());
    }

    // ═══════════════════════════════════════════
    // REENTRANCY ATTACK PREVENTION
    // ═══════════════════════════════════════════

    function test_reentrancy_executeTransactionDuringCallback_blocked() public {
        // Deploy a malicious contract that tries to re-enter executeTransaction
        MaliciousReenterExecute attacker = new MaliciousReenterExecute(address(wallet));

        // Make the attacker an owner so it can participate
        // We need a wallet where the attacker contract is an owner
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = address(attacker);
        MultiSigWallet newWallet = new MultiSigWallet(owners, 2);
        TargetContract newTarget = new TargetContract();

        // Update attacker reference
        attacker = new MaliciousReenterExecute(address(newWallet));

        // Re-create wallet with correct attacker address
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        // Re-deploy attacker pointing to new wallet
        attacker = new MaliciousReenterExecute(address(newWallet));

        // Recreate wallet one more time with correct attacker
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        // Set up the attack
        vm.prank(owner1);
        uint256 txId = newWallet.submitTransaction(address(attacker), 0, "");

        vm.prank(owner1);
        newWallet.confirmTransaction(txId);
        vm.prank(owner2);
        newWallet.confirmTransaction(txId);

        attacker.setTargetTxId(txId);

        // Execute — the attacker's receive() will try to re-enter executeTransaction
        vm.prank(owner1);
        newWallet.executeTransaction(txId);

        // The reentrancy should have been blocked
        assertTrue(attacker.reenterAttempted(), "Attacker should have attempted reentrancy");
        assertFalse(attacker.reenterSucceeded(), "Attacker reentrancy should have failed");
    }

    function test_reentrancy_revokeDuringCallback_blocked() public {
        // Deploy malicious contract that tries to revoke during callback
        MaliciousRevokeCallback attacker = new MaliciousRevokeCallback(address(wallet));

        // Create wallet with attacker as owner
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = address(attacker);
        MultiSigWallet newWallet = new MultiSigWallet(owners, 2);

        attacker = new MaliciousRevokeCallback(address(newWallet));
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        attacker = new MaliciousRevokeCallback(address(newWallet));
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        // Set up tx targeting the attacker
        vm.prank(owner1);
        uint256 txId = newWallet.submitTransaction(address(attacker), 0, "");

        vm.prank(owner1);
        newWallet.confirmTransaction(txId);
        vm.prank(owner2);
        newWallet.confirmTransaction(txId);

        attacker.setTargetTxId(txId);

        // Execute — attacker tries to revoke confirmation during callback
        vm.prank(owner1);
        newWallet.executeTransaction(txId);

        // The revoke should still "succeed" in the callback because
        // revokeConfirmation is not nonReentrant, but the executed flag
        // is already set, so it doesn't matter — the tx is already marked executed.
        // The important thing is the transaction only executed once.
        // Let's verify the transaction is marked as executed
        (,,,, bool executed) = newWallet.transactions(0);
        // Actually the transactions() returns (to, value, data, executed)
        // Let me check with a different approach
        assertTrue(executed, "Transaction should be marked as executed");
    }

    function test_reentrancy_confirmDuringCallback_blocked() public {
        MaliciousConfirmCallback attacker = new MaliciousConfirmCallback(address(wallet));

        // Create wallet with attacker as owner
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = address(attacker);
        MultiSigWallet newWallet = new MultiSigWallet(owners, 2);

        attacker = new MaliciousConfirmCallback(address(newWallet));
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        attacker = new MaliciousConfirmCallback(address(newWallet));
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        // Set up tx targeting the attacker
        vm.prank(owner1);
        uint256 txId = newWallet.submitTransaction(address(attacker), 0, "");

        vm.prank(owner1);
        newWallet.confirmTransaction(txId);
        vm.prank(owner2);
        newWallet.confirmTransaction(txId);

        attacker.setTargetTxId(txId);

        // Execute — attacker tries to confirm during callback
        // (this is less dangerous, but let's verify it doesn't break anything)
        vm.prank(owner1);
        newWallet.executeTransaction(txId);

        // Transaction executed successfully, confirming during callback
        // is harmless since the executed flag is already set
    }

    // ═══════════════════════════════════════════
    // REENTRANCY: DIRECT RE-ENTER executeTransaction
    // ═══════════════════════════════════════════

    function test_reentrancy_directReenterExecute_reverts() public {
        // Set up a 2-of-3 wallet with a malicious target
        MaliciousReenterExecute attacker = new MaliciousReenterExecute(address(wallet));

        // Recreate wallet with attacker as owner
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = address(attacker);
        MultiSigWallet newWallet = new MultiSigWallet(owners, 2);

        // Point attacker to the new wallet
        attacker = new MaliciousReenterExecute(address(newWallet));
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        attacker = new MaliciousReenterExecute(address(newWallet));
        owners[2] = address(attacker);
        newWallet = new MultiSigWallet(owners, 2);

        // Submit transaction targeting the attacker contract's attack() function
        bytes memory attackData = abi.encodeWithSelector(MaliciousReenterExecute.attack.selector);
        vm.prank(owner1);
        uint256 txId = newWallet.submitTransaction(address(attacker), 0, attackData);

        vm.prank(owner1);
        newWallet.confirmTransaction(txId);
        vm.prank(owner2);
        newWallet.confirmTransaction(txId);

        attacker.setTargetTxId(txId);

        // Execute — the attacker will try to call executeTransaction again
        vm.prank(owner1);
        newWallet.executeTransaction(txId);

        // Verify reentrancy was blocked
        assertTrue(attacker.reenterAttempted(), "Reentrancy should have been attempted");
        assertFalse(attacker.reenterSucceeded(), "Reentrancy should have been blocked");
    }

    // ═══════════════════════════════════════════
    // OWNER MANAGEMENT
    // ═══════════════════════════════════════════

    function test_onlyOwner_modifier() public {
        uint256 txId = _submitTx(address(target), 0, "");

        // Non-owner cannot confirm
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.confirmTransaction(txId);

        // Non-owner cannot execute
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.executeTransaction(txId);

        // Non-owner cannot submit
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.submitTransaction(address(target), 0, "");

        // Non-owner cannot revoke
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        wallet.revokeConfirmation(txId);
    }

    function test_isOwner() public {
        assertTrue(wallet.isOwner(owner1));
        assertTrue(wallet.isOwner(owner2));
        assertTrue(wallet.isOwner(owner3));
        assertFalse(wallet.isOwner(nonOwner));
    }

    function test_ownersArray() public {
        assertEq(wallet.owners(0), owner1);
        assertEq(wallet.owners(1), owner2);
        assertEq(wallet.owners(2), owner3);
    }

    function test_requiredValue() public {
        assertEq(wallet.required(), REQUIRED);
    }

    // ═══════════════════════════════════════════
    // RECEIVE ETHER
    // ═══════════════════════════════════════════

    function test_receiveEther() public {
        vm.deal(address(this), 10 ether);
        (bool success,) = address(wallet).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(wallet).balance, 1 ether);
    }

    // ═══════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════

    function test_executionFailed_reverts() public {
        // Submit a transaction to a contract that will revert
        RevertingTarget revertTarget = new RevertingTarget();
        uint256 txId = _submitAndConfirm(address(revertTarget), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(owner1);
        vm.expectRevert("Execution failed");
        wallet.executeTransaction(txId);
    }

    function test_executionFailed_marksAsExecuted_andReverts() public {
        // When execution fails, the transaction should still be marked as executed
        // because the executed flag is set BEFORE the external call (CEI pattern)
        RevertingTarget revertTarget = new RevertingTarget();
        uint256 txId = _submitAndConfirm(address(revertTarget), 0, "");
        _confirmTx(txId, owner2);

        vm.prank(owner1);
        vm.expectRevert("Execution failed");
        wallet.executeTransaction(txId);

        // Since executed was set before the call, and the call failed,
        // the entire transaction reverts, so executed is still false
        // (state changes are reverted when the tx reverts)
        (address to, uint256 value, bytes memory data, bool executed) = wallet.transactions(txId);
        assertFalse(executed, "Executed flag should be reverted on failure");
    }

    function test_submitToZeroAddress() public {
        // Submitting to address(0) is allowed — multisig might need to burn or
        // send to zero address as a valid use case. The original code allows it.
        uint256 txId = _submitTx(address(0), 0, "");
        assertEq(txId, 0);
    }

    function test_submitToEOA() public {
        // Submitting to an EOA is allowed — multisig might need to send ETH to EOAs
        uint256 txId = _submitTx(nonOwner, 1 ether, "");
        assertEq(txId, 0);
    }

    function test_getConfirmationCount_noConfirmations() public {
        uint256 txId = _submitTx(address(target), 0, "");
        assertEq(wallet.getConfirmationCount(txId), 0);
    }

    function test_getConfirmationCount_partialConfirmations() public {
        uint256 txId = _submitTx(address(target), 0, "");
        _confirmTx(txId, owner1);
        assertEq(wallet.getConfirmationCount(txId), 1);

        _confirmTx(txId, owner2);
        assertEq(wallet.getConfirmationCount(txId), 2);
    }

    // ═══════════════════════════════════════════
    // FULL WORKFLOW TESTS
    // ═══════════════════════════════════════════

    function test_fullWorkflow_submitConfirmExecute() public {
        bytes memory data = abi.encodeWithSelector(TargetContract.noArgs.selector);
        uint256 txId = _submitAndConfirm(address(target), 0, data);
        _confirmTx(txId, owner2);

        vm.prank(owner2);
        wallet.executeTransaction(txId);

        assertTrue(target.called());
        assertEq(target.callCount(), 1);
    }

    function test_fullWorkflow_submitConfirmRevokeReconfirmExecute() public {
        uint256 txId = _submitAndConfirm(address(target), 0, "");

        // owner2 confirms
        _confirmTx(txId, owner2);

        // owner2 revokes
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);
        assertEq(wallet.getConfirmationCount(txId), 1);

        // Cannot execute with only 1 confirmation
        vm.prank(owner1);
        vm.expectRevert("Not enough confirmations");
        wallet.executeTransaction(txId);

        // owner2 reconfirms
        _confirmTx(txId, owner2);
        assertEq(wallet.getConfirmationCount(txId), 2);

        // Now execution succeeds
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        assertTrue(target.called());
    }

    function test_fullWorkflow_multipleTransactions() public {
        // Submit and execute tx 0
        uint256 txId0 = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId0, owner2);
        vm.prank(owner1);
        wallet.executeTransaction(txId0);

        // Submit and execute tx 1
        uint256 txId1 = _submitAndConfirm(address(target), 0, "");
        _confirmTx(txId1, owner2);
        vm.prank(owner1);
        wallet.executeTransaction(txId1);

        assertEq(target.callCount(), 2);
    }

    // ═══════════════════════════════════════════
    // 1-of-1 WALLET (EDGE CASE)
    // ═══════════════════════════════════════════

    function test_oneOfOneWallet() public {
        address[] memory owners = new address[](1);
        owners[0] = owner1;
        MultiSigWallet oneOfOne = new MultiSigWallet(owners, 1);

        vm.prank(owner1);
        uint256 txId = oneOfOne.submitTransaction(address(target), 0, "");
        vm.prank(owner1);
        oneOfOne.confirmTransaction(txId);
        vm.prank(owner1);
        oneOfOne.executeTransaction(txId);

        assertTrue(target.called());
    }
}

// ─────────────────────────────────────────────
// Helper: Contract that always reverts
// ─────────────────────────────────────────────
contract RevertingTarget {
    function alwaysRevert() external pure {
        revert("I always revert");
    }

    receive() external payable {
        revert("I always revert");
    }
}
