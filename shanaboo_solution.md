```diff
--- a/solidity/contracts/LiquidityPool.sol
+++ b/solidity/contracts/LiquidityPool.sol
@@ -1,6 +1,8 @@
 // SPDX-License-Identifier: MIT
 pragma solidity ^0.8.0;
 
+import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
+
 /**
  * @title LiquidityPool
  * @dev A simple liquidity pool that mints LP tokens proportional to deposited assets
@@ -8,6 +10,12 @@
 contract LiquidityPool {
     string public constant name = "LiquidityPool";
     
+    uint256 public constant MINIMUM_LIQUIDITY = 1000;
+    
+    uint256 public reserve0;
+    uint256 public reserve1;
+    
+    event Sync(uint256 reserve0, uint256 reserve1);
+    
     // LP token tracking (simplified - in production use ERC20)
     mapping(address => uint256) public balanceOf;
     uint256 public totalSupply;
@@ -30,6 +38,9 @@
         token1 = _token1;
     }
     
+    /**
+     * @dev Get the balance of a token held by this contract
+     */
     function _getBalance(address token) internal view returns (uint256) {
         (bool success, bytes memory data) = token.staticcall(
             abi.encodeWithSelector(IERC20(token).balanceOf.selector, address(this))
@@ -38,6 +49,22 @@
         return abi.decode(data, (uint256));
     }
     
+    /**
+     * @dev Update reserves to match actual balances
+     */
+    function _updateReserves() internal {
+        reserve0 = _getBalance(token0);
+        reserve1 = _getBalance(token1);
+    }
+    
+    /**
+     * @dev Sync reserves with actual balances (can be used for recovery)
+     */
+    function sync() external {
+        _updateReserves();
+        emit Sync(reserve0, reserve1);
+    }
+    
     /**
      * @dev Add liquidity to the pool and mint LP tokens
      */
@@ -47,18 +74,32 @@
         require(amount0 > 0 && amount1 > 0, "Invalid amounts");
         
         // Transfer tokens from sender
-        _safeTransferFrom(token0, msg.sender, amount0);
-        _safeTransferFrom(token1, msg.sender, amount1);
+        _safeTransferFrom(token0, msg.sender, address(this), amount0);
+        _safeTransferFrom(token1, msg.sender, address(this), amount1);
         
         uint256 lpTokensToMint;
         
         if (totalSupply == 0) {
-            // First deposit - mint LP tokens equal to geometric mean
-            lpTokensToMint = sqrt(amount0 * amount1);
+            // First deposit - calculate geometric mean
+            uint256 liquidity = sqrt(amount0 * amount1);
+            require(liquidity > MINIMUM_LIQUIDITY, "Insufficient initial liquidity");
+            
+            // Lock minimum liquidity permanently
+            lpTokensToMint = liquidity - MINIMUM_LIQUIDITY;
+            
+            // Mint locked tokens to address(0)
+            balanceOf[address(0)] = MINIMUM_LIQUIDITY;
+            totalSupply = MINIMUM_LIQUIDITY;
+            
+            // Mint remaining to depositor
+            balanceOf[msg.sender] = lpTokensToMint;
+            totalSupply += lpTokensToMint;
+            
+            _updateReserves();
+            emit Sync(reserve0, reserve1);
+            return lpTokensToMint;
         } else {
-            // Subsequent deposits - proportional to existing liquidity
-            uint256 lp0 = (amount0 * totalSupply) / _getBalance(token0);
-            uint256 lp1 = (amount1 * totalSupply) / _getBalance(token1);
+            // Subsequent deposits - proportional to existing reserves
+            uint256 lp0 = (amount0 * totalSupply) / reserve0;
+            uint256 lp1 = (amount1 * totalSupply) / reserve1;
             lpTokensToMint = lp0 < lp1 ? lp0 : lp1;
         }
         
@@ -66,6 +99,9 @@
         totalSupply += lpTokensToMint;
         
         emit LiquidityAdded(msg.sender, amount0, amount1, lpTokensToMint);
+        _updateReserves();
+        emit Sync(reserve0, reserve1);
+        
         return lpTokensToMint;
     }
     
@@ -73,8 +109,8 @@
      * @dev Remove liquidity from the pool and burn LP tokens
      */
     function removeLiquidity(uint256 lpAmount) external returns (uint256 amount0, uint256 amount1) {
-        uint256 balance0 = _getBalance(token0);
-        uint256 balance1 = _getBalance(token1);
+        uint256 _reserve0 = reserve0;
+        uint256 _reserve1 = reserve1;
         
         uint256 lpBalance = balanceOf[msg.sender];
         require(lpAmount > 0 && lpAmount <= lpBalance, "Invalid LP amount");
@@ -82,8 +118,8 @@
         // Calculate amounts to return proportional to LP tokens
         // amount / total = lpAmount / totalSupply
         // amount = lpAmount * balance / totalSupply
-        amount0 = (lpAmount * balance0) / totalSupply;
-        amount1 = (lpAmount * balance1) / totalSupply;
+        amount0 = (lpAmount * _reserve0) / totalSupply;
+        amount1 = (lpAmount * _reserve1) / totalSupply;
         
         require(amount0 > 0 && amount1 > 0, "Insufficient liquidity");
         
@@ -93,9 +129,13 @@
         totalSupply -= lpAmount;
         
         // Transfer tokens back to sender
-        _safeTransfer(token0, msg.sender, amount0);
-        _safeTransfer(token1, msg.sender, amount1);
+        _safeTransfer(token0, msg.sender, amount0);
+        _safeTransfer(token1, msg.sender, amount1);
         
         emit LiquidityRemoved(msg.sender, amount0, amount1, lpAmount);
+        
+        _updateReserves();
+        emit Sync(reserve0, reserve1);
+        
         return (amount0, amount1);
     }
     
@@ -103,9 +143,9 @@
      * @dev Safe ERC20 transferFrom
      */
-    function _safeTransferFrom(address token, address from, uint256 amount) internal {
+    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
         (bool success, bytes memory data) = token.call(
-            abi.encodeWithSelector(IERC20(token).transferFrom.selector, from, address(this), amount)
+            abi.encodeWithSelector(IERC20(token).transferFrom.selector, from, to, amount)
         );
         require(success