```diff
--- a/solidity/contracts/MultiSigWallet.sol
+++ b/solidity/contracts/MultiSigWallet.sol
@@ -1,6 +1,7 @@
 // SPDX-License-Identifier: MIT
 pragma solidity ^0.8.0;
 
+import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
 import "@openzeppelin/contracts/access/Ownable.sol";
 
 /**
@@ -8,7 +9,7 @@ import "@openzeppelin/contracts/access/Ownable.sol";
  * @dev A multi-signature wallet requiring N of M confirmations to execute transactions.
  *      Includes confirmation, revocation, and execution with reentrancy protection.
  */
-contract MultiSigWallet is Ownable {
+contract MultiSigWallet is Ownable, ReentrancyGuard {
     // ============ Errors ============
     error InvalidOwner();
     error DuplicateOwner();
@@ -19,6 +20,8 @@ contract MultiSigWallet is Ownable {
     error TransactionAlreadyExecuted();
     error TransactionAlreadyConfirmed();
     error TransactionNotConfirmed();
+    error ZeroAddressNotAllowed();
+    error RevokedDuringExecution();
 
     // ============ Events ============
     event Deposit(address indexed sender, uint256 amount);
@@ -37,7 +40,8 @@ contract MultiSigWallet is Ownable {
         uint256 value;
         bytes data;
         bool executed;
-        uint256 numConfirmations;
+        uint256 numConfirmations; // Kept for compatibility, but not solely relied upon
+        uint256 executionBlock;
     }
 
     // ============ State Variables ============
@@ -45,7 +49,8 @@ contract MultiSigWallet is Ownable {
     mapping(address => bool) public isOwner;
     uint256 public numConfirmationsRequired;
 
-    mapping(uint256 => mapping(address => bool)) public confirmations;
+    // confirmations[txId][owner] => block number at which confirmation was made (0 = not confirmed)
+    mapping(uint256 => mapping(address => uint256)) public confirmations;
     mapping(uint256 => Transaction) public transactions;
 
     uint256 public transactionCount;
@@ -88,6 +93,10 @@ contract MultiSigWallet is Ownable {
         if (_to == address(0)) {
             revert ZeroAddressNotAllowed();
         }
+        // Reject calls to contracts with no code to prevent common mistakes
+        if (_to.code.length == 0 && _value == 0 && _data.length == 0) {
+            revert ZeroAddressNotAllowed();
+        }
 
         uint256 txId = transactionCount;
         transactions[txId] = Transaction({
@@ -95,7 +104,8 @@ contract MultiSigWallet is Ownable {
             value: _value,
             data: _data,
             executed: false,
-            numConfirmations: 0
+            numConfirmations: 0,
+            executionBlock: 0
         });
 
         emit TransactionSubmitted(txId, _to, _value, _data);
@@ -108,7 +118,7 @@ contract MultiSigWallet is Ownable {
      */
     function confirmTransaction(uint256 _txId) public onlyOwner txExists(_txId) notExecuted(_txId) {
         if (_txId >= transactionCount) revert TransactionDoesNotExist();
-        if (confirmations[_txId][msg.sender]) revert TransactionAlreadyConfirmed();
+        if (confirmations[_txId][msg.sender] > 0) revert TransactionAlreadyConfirmed();
 
         confirmations[_txId][msg.sender] = block.number;
         transactions[_txId].numConfirmations++;
@@ -122,7 +132,7 @@ contract MultiSigWallet is Ownable {
      */
     function revokeConfirmation(uint256 _txId) public onlyOwner txExists(_txId) notExecuted(_txId) {
         if (_txId >= transactionCount) revert TransactionDoesNotExist();
-        if (!confirmations[_txId][msg.sender]) revert TransactionNotConfirmed();
+        if (confirmations[_txId][msg.sender] == 0) revert TransactionNotConfirmed();
 
         confirmations[_txId][msg.sender] = 0;
         transactions[_txId].numConfirmations--;
@@ -130,6 +140,24 @@ contract MultiSigWallet is Ownable {
         emit ConfirmationRevoked(_txId, msg.sender);
     }
 
+    /**
+     * @notice Check if a transaction is confirmed by a specific owner as of a given block.
+     * @param _txId The transaction ID.
+     * @param _owner The owner address.
+     * @param _blockNumber The block number to check at.
+     * @return True if the owner had confirmed before or at _blockNumber and has not revoked.
+     */
+    function isConfirmedAtBlock(uint256 _txId, address _owner, uint256 _blockNumber) public view returns (bool) {
+        uint256 confirmedBlock = confirmations[_txId][_owner];
+        if (confirmedBlock == 0) return false;
+        if (confirmedBlock > _blockNumber) return false;
+        // Check if the transaction was executed and if this confirmation was active at execution time
+        if (transactions[_txId].executed && transactions[_txId].executionBlock > 0 && confirmedBlock > transactions[_txId].executionBlock) {
+            return false;
+        }
+        // If not executed, just check the block
+        return true;
+    }
+
     /**
      * @notice Execute a confirmed transaction.
      * @param _txId The transaction ID to execute.
@@ -137,7 +165,7 @@ contract MultiSigWallet is Ownable {
     function executeTransaction(uint256 _txId)
         public
         txExists(_txId)
-        notExecuted(_txId)
+        notExecuted(_txId) nonReentrant
     {
         Transaction storage txn = transactions[_txId];
 
@@ -145,6 +173,9 @@ contract MultiSigWallet is Ownable {
             revert NotEnoughConfirmations();
         }
 
+        // Record execution block before external call for front-running protection
+        txn.executionBlock = block.number;
+
         // Re-verify confirmations after any potential state changes (reentrancy guard is active)
         uint256 activeConfirmations = 0;
         for (uint256 i = 0; i < owners.length; i++) {
@@ -153,6 +184,11 @@ contract MultiSigWallet is Ownable {
             }
         }
 
+        // If confirmations dropped below required, revert
+        if (activeConfirmations < numConfirmationsRequired) {
+            revert RevokedDuringExecution();
+        }
+
         txn.executed = true;
 
         (bool success, ) = txn.to.call{value: txn.value}(txn.data);
@@ -162,6 +198,9 @@ contract MultiSigWallet is Ownable {
         }
 
         emit TransactionExecuted(_txId);
+        // Reset execution block after successful execution to allow future reference
+        // Keep it set to mark as executed
+        txn.executionBlock = block.number;
     }
 
     /**
@@ -172,7 +211,7 @@ contract MultiSigWallet is Ownable {
