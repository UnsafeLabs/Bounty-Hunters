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
  * @title MultiSigWallet
  * @dev A multi-signature wallet requiring N of M confirmations to execute transactions
  */
-contract MultiSigWallet is Ownable {
+contract MultiSigWallet is Ownable, ReentrancyGuard {
     // ============ Events ============
     event Deposit(address indexed sender, uint256 amount);
     event TransactionSubmitted(uint256 indexed txId, address indexed to, uint256 value, bytes data);
@@ -25,7 +26,8 @@ contract MultiSigWallet is Ownable {
     uint256 public requiredConfirmations;
 
     mapping(uint256 => Transaction) public transactions;
-    mapping(uint256 => mapping(address => bool)) public confirmations;
+    // txId => owner => timestamp of confirmation (0 if not confirmed or revoked)
+    mapping(uint256 => mapping(address => uint256)) public confirmations;
     mapping(uint256 => uint256) public confirmationCount;
 
     uint256 public transactionCount;
@@ -40,6 +42,12 @@ contract MultiSigWallet is Ownable {
     }
 
     function submitTransaction(address to, uint256 value, bytes memory data) external onlyOwner returns (uint256) {
+        require(to != address(0), "MultiSigWallet: zero address not allowed");
+        // If value is 0, this might be a contract call; check code size
+        if (value == 0) {
+            require(to.code.length > 0, "MultiSigWallet: target must be a contract for zero-value calls");
+        }
+
         uint256 txId = transactionCount;
         transactions[txId] = Transaction({
             to: to,
@@ -62,7 +70,7 @@ contract MultiSigWallet is Ownable {
     }
 
     function confirmTransaction(uint256 txId) external onlyOwner {
-        require(!confirmations[txId][msg.sender], "Already confirmed");
+        require(confirmations[txId][msg.sender] == 0, "Already confirmed");
         require(transactions[txId].to != address(0), "Transaction does not exist");
 
         confirmations[txId][msg.sender] = block.timestamp;
@@ -74,7 +82,7 @@ contract MultiSigWallet is Ownable {
     }
 
     function revokeConfirmation(uint256 txId) external onlyOwner {
-        require(confirmations[txId][msg.sender], "Not confirmed");
+        require(confirmations[txId][msg.sender] > 0, "Not confirmed");
         require(!transactions[txId].executed, "Already executed");
 
         delete confirmations[txId][msg.sender];
@@ -85,7 +93,7 @@ contract MultiSigWallet is Ownable {
     }
 
     function isConfirmed(uint256 txId) public view returns (bool) {
-        return confirmationCount[txId] >= requiredConfirmations;
+        return _countActiveConfirmations(txId) >= requiredConfirmations;
     }
 
     function getConfirmationCount(uint256 txId) external view returns (uint256) {
@@ -93,11 +101,19 @@ contract MultiSigWallet is Ownable {
     }
 
     function getConfirmations(uint256 txId) external view returns (address[] memory) {
-        return _getConfirmations(txId);
+        return _getConfirmationsAtBlock(txId, block.number);
     }
 
-    function executeTransaction(uint256 txId) external onlyOwner {
+    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
         require(!transactions[txId].executed, "Already executed");
+        require(isConfirmed(txId), "Not enough confirmations");
+
+        // Snapshot confirmation state to detect revocations during callback
+        uint256 snapshotCount = _countActiveConfirmations(txId);
+        require(snapshotCount >= requiredConfirmations, "Not enough confirmations at snapshot");
+
+        // Build list of confirmed owners at this point
+        address[] memory confirmedOwners = _getConfirmationsAtBlock(txId, block.number);
+
         Transaction storage txn = transactions[txId];
         require(isConfirmed(txId), "Not enough confirmations");
 
@@ -106,6 +122,15 @@ contract MultiSigWallet is Ownable {
         (bool success, ) = txn.to.call{value: txn.value}(txn.data);
         require(success, "Transaction failed");
 
+        // Post-call check: ensure no confirmations were revoked during the external call
+        uint256 postCount = 0;
+        for (uint256 i = 0; i < confirmedOwners.length; i++) {
+            if (confirmations[txId][confirmedOwners[i]] > 0) {
+                postCount++;
+            }
+        }
+        require(postCount >= requiredConfirmations, "Confirmations revoked during execution");
+
         emit TransactionExecuted(txId);
     }
 
@@ -117,6 +142,10 @@ contract MultiSigWallet is Ownable {
         return _getConfirmations(txId);
     }
 
+    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) external view returns (bool) {
+        return _countActiveConfirmationsAtBlock(txId, blockNumber) >= requiredConfirmations;
+    }
+
     // ============ Internal Functions ============
 
     function _getConfirmations(uint256 txId) internal view returns (address[] memory) {
@@ -130,6 +159,47 @@ contract MultiSigWallet is Ownable {
         return owners;
     }
 
+    function _getConfirmationsAtBlock(uint256 txId, uint256 blockNumber) internal view returns (address[] memory) {
+        // For simplicity, we return current confirmations but this can be extended
+        // with historical block tracking if needed
+        (void)blockNumber;
+        return _getConfirmations(txId);
+    }
+
+    function _countActiveConfirmations(uint256 txId) internal view returns (uint256) {
+        uint256 count = 0;
+        for (uint256 i = 0; i < owners.length; i++) {
+            if (confirmations[txId][owners[i]] > 0) {
+                count++;
+            }
+        }
+        return count;
+    }
+
+    function _countActiveConfirmationsAtBlock(uint256 txId, uint256 blockNumber) internal view returns (uint256) {
+        // This is a simplified implementation. In production, you would use
+        // a more sophisticated approach with checkpointing for true block-level history.
+        // For the purpose of this fix, we assume confirmations before a block
+        // are valid if they existed at that point.
+        (void)blockNumber;
+