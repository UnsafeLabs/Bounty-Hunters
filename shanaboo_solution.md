```diff
--- a/solidity/contracts/MultiSigWallet.sol
+++ b/solidity/contracts/MultiSigWallet.sol
@@ -1,6 +1,7 @@
 // SPDX-License-Identifier: MIT
 pragma solidity ^0.8.0;
 
+/// @title MultiSigWallet - A multi-signature wallet with confirmation tracking
 contract MultiSigWallet {
     address[] public owners;
     mapping(address => bool) public isOwner;
@@ -8,7 +9,12 @@
 
     struct Transaction {
         address to;
+        address from;
         uint256 value;
+        uint256 confirmations;
+        bool executed;
+        bytes data;
+    }
+
     uint256 public transactionCount;
     mapping(uint256 => Transaction) public transactions;
     mapping(uint256 => mapping(address => bool)) public confirmations;
@@ -16,6 +22,15 @@
     event SubmitTransaction(uint256 indexed txId, address indexed owner, address indexed to, uint256 value);
     event ConfirmTransaction(uint256 indexed txId, address indexed owner);
     event RevokeConfirmation(uint256 indexed txId, address indexed owner);
+    event ExecuteTransaction(uint256 indexed txId, address indexed owner);
+
+    /// @notice Timestamp when each owner confirmed a transaction (0 if not confirmed)
+    mapping(uint256 => mapping(address => uint256)) public confirmationTimestamp;
+    /// @notice Block number when each owner confirmed a transaction (0 if not confirmed)
+    mapping(uint256 => mapping(address => uint256)) public confirmationBlock;
+    
+    /// @notice Reentrancy guard
+    uint256 private constant _NOT_ENTERED = 1;
+    uint256 private constant _ENTERED = 2;
+    uint256 private _status;
 
     modifier onlyOwner() {
         require(isOwner[msg.sender], "Not owner");
@@ -27,6 +42,11 @@
         _;
     }
 
+    modifier nonReentrant() {
+        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
+        _status = _ENTERED;
+        _;
+        _status = _NOT_ENTERED;
+    }
+
     constructor(address[] memory _owners, uint256 _required) {
         require(_owners.length > 0, "Owners required");
         require(_required > 0 && _required <= _owners.length, "Invalid required number");
@@ -38,9 +58,15 @@
             isOwner[owner] = true;
         }
         required = _required;
+        _status = _NOT_ENTERED;
     }
 
     function submitTransaction(address _to, uint256 _value, bytes memory _data) public onlyOwner {
+        require(_to != address(0), "Invalid destination address");
+        // Check if target is a contract (has code size > 0)
+        uint256 codeSize;
+        assembly {
+            codeSize := extcodesize(_to)
+        }
+        // Allow EOAs (codeSize == 0) but note contract targets
+        // This is informational; we don't block contracts but document the check
         uint256 txId = transactionCount;
         transactions[txId] = Transaction({
             to: _to,
@@ -52,6 +78,7 @@
         transactionCount++;
 
         emit SubmitTransaction(txId, msg.sender, _to, _value);
+        confirmTransaction(txId);
     }
 
     function confirmTransaction(uint256 _txId) public onlyOwner txExists(_txId) {
@@ -59,6 +86,8 @@
         require(!confirmations[_txId][msg.sender], "Already confirmed");
 
         confirmations[_txId][msg.sender] = true;
+        confirmationTimestamp[_txId][msg.sender] = block.timestamp;
+        confirmationBlock[_txId][msg.sender] = block.number;
         transactions[_txId].confirmations++;
 
         emit ConfirmTransaction(_txId, msg.sender);
@@ -70,6 +99,8 @@
         require(confirmations[_txId][msg.sender], "Not confirmed");
 
         confirmations[_txId][msg.sender] = false;
+        confirmationTimestamp[_txId][msg.sender] = 0;
+        confirmationBlock[_txId][msg.sender] = 0;
         transactions[_txId].confirmations--;
 
         emit RevokeConfirmation(_txId, msg.sender);
@@ -80,15 +109,46 @@
         return transactions[_txId].confirmations >= required;
     }
 
+    /// @notice Check if a transaction is confirmed as of a specific block number
+    /// @param _txId Transaction ID
+    /// @param _blockNumber Block number to check confirmation status at
+    /// @return True if the transaction had sufficient confirmations at the given block
+    function isConfirmedAtBlock(uint256 _txId, uint256 _blockNumber) public view txExists(_txId) returns (bool) {
+        require(_blockNumber <= block.number, "Invalid block number");
+        
+        uint256 count = 0;
+        for (uint256 i = 0; i < owners.length; i++) {
+            // A confirmation is valid at a block if it was made at or before that block
+            // and not revoked before that block
+            if (confirmationBlock[_txId][owners[i]] > 0 && 
+                confirmationBlock[_txId][owners[i]] <= _blockNumber) {
+                count++;
+            }
+        }
+        return count >= required;
+    }
+
+    /// @notice Get the number of valid confirmations at a specific block
+    function getConfirmationCountAtBlock(uint256 _txId, uint256 _blockNumber) public view txExists(_txId) returns (uint256) {
+        require(_blockNumber <= block.number, "Invalid block number");
+        
+        uint256 count = 0;
+        for (uint256 i = 0; i < owners.length; i++) {
+            if (confirmationBlock[_txId][owners[i]] > 0 && 
+                confirmationBlock[_txId][owners[i]] <= _blockNumber) {
+                count++;
+            }
+        }
+        return count;
+    }
+
     function getTransactionCount() public view returns (uint256) {
         return transactionCount;
     }
 
     function getOwners() public view returns (address[] memory) {
         return owners;
     }
 
-    function executeTransaction(uint256 _txId) public onlyOwner txExists(_txId) {
+    function executeTransaction(uint256 _txId) public onlyOwner txExists(_txId) nonReentrant {
         Transaction storage txn = transactions[_txId];
         require(!txn.executed, "Already executed");
         require(isConfirmed(_txId), "Not confirmed");
@@ -96,6 +156,20 @@
         txn.executed = true;
 
         (bool success, ) = txn.to.call{value: txn.value}(txn.data);
+        
+        // Re-check confirmations after external call to detect rev