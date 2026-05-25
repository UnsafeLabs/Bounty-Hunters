Looking at the issue description, I need to fix the first-depositor price manipulation vulnerability in the LiquidityPool contract. Let me create the necessary changes based on the requirements.

```diff
--- a/solidity/contracts/LiquidityPool.sol
+++ b/solidity/contracts/LiquidityPool.sol
@@ -1,4 +1,4 @@
-// SPDX-License-Identifier: MIT
 pragma solidity ^0.8.0;
+// SPDX-License-Identifier: MIT
 
 /**
@@ -16,6 +15,19 @@ contract LiquidityPool is ILiquidityPool, Reentrancy, Ownable {
     uint256 public totalSupply;
     mapping(address => uint256) public balanceOf;
 
+    // Minimum liquidity to prevent first depositor attack
+    uint256 public constant MINIMUM_LIQUIDITY = 1000;
+    
+    // Reserve tracking for non-manipulable accounting
+    uint256 private _reserve0;
+    uint256 private _reserve1;
+    uint256 private _blockTimestampLast;
+    
+    // Events
+    event Sync(uint128 reserve0, uint128 reserve1);
+    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
+    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
+
     constructor(
         IERC20Metadata token0,
@@ -23,19 +35,19 @@ contract LiquidityPool is ILiquidityPool, Reentrancy, Ownable {
         string memory lpTokenName,
         string memory lpTokenSymbol
     ) {
-        _token0 = token0;
-        _token1 = token1;
-        _lpTokenName = lpTokenName;
-        _lpTokenSymbol = lpTokenSymbol;
+        _token0 = token0;
+        _token1 = token1;
+        _lpTokenName = lpToken0Name;
+        _lpTokenSymbol = lpTokenSymbol;
     }
 
-    function initialize(
-        address token0,
-        address token1,
-        string memory lpTokenName,
-        string memory lpTokenSymbol
-    ) public {
-        _token0 = IERC20(token0);
-        _token1 = IERC20(token1);
-        _lpTokenName = lpTokenName;
-        _lpTokenSymbol = lpTokenSymbol;
+    function initialize() public {
+        // Initialize with zero address to prevent first depositor attack
+        _token0 = IERC20(address(0));
+        _token1 = IERC20(address(0));
+        _lpTokenName = "";
+        _lpTokenSymbol = "";
+        totalSupply = 0;
+        balanceOf[address(0)] = 0;
+        _reserve0 = 0;
+        _reserve1 = 0;
+        _blockTimestampLast = 0;
     }
@@ -43,7 +53,7 @@ contract LiquidityPool is ILiquidityPool, Reentrancy, Ownable {
     }
 
     function addLiquidity(
-        uint256 amount0,
-        uint256 amount1,
+        uint256 amount0,
+        uint256 amount1,
         address to
     ) external override nonReentrant returns (uint256 liquidity) {
         require(amount0 > 0 && amount1 > 0, "INVALID_AMOUNT");
@@ -51,15 +60,15 @@ contract LiquidityPool is ILiquidityPool, Reentrancy, Ownable {
         _token0.transferFrom(msg.sender, address(this), amount0);
         _token1.transferFrom(msg.sender, address(this), amount1);
 
-        if (totalSupply == 0) {
+        if (totalSupply == 0) {
             // First liquidity provider: mint liquidity tokens to them
-            liquidity = _mintLPTokens(amount0, amount1, to);
-            return liquidity;
-        }
+            liquidity = _mintLPTokens(amount0, amount1, to);
+            return liquidity;
+        }
 
-        function _mintLPTokens(
-            uint256 amount0,
-            uint256 amount1,
-            address to
-        ) internal returns (uint256) {
-            uint256 _totalSupply = totalSupply;
-            if (_totalSupply == 0) {
-                // First deposit - lock minimum liquidity
-                uint256 minLiquidity = MINIMUM_LIQUIDITY;
-                uint256 liquidity = sqrt(amount0 * amount1) - minLiquidity;
-                if (liquidity < minLiquidity) {
-                    revert("First deposit must be at least MINIMUM_LIQUIDITY");
-                }
-                _mint(to, liquidity);
-                _mint(address(0), minLiquidity);
-                return liquidity;
-            } else {
-                // Subsequent deposits
-                uint256 liquidity = _mintLPTokens(amount0, amount1, to);
-                return liquidity;
-            }
-        }
+        function _mintLPTokens(
+            uint256 amount0,
+            uint256 amount1,
+            address to
+        ) internal returns (uint256) {
+            uint256 _totalSupply = totalSupply;
+            uint256 minLiquidity = MINIMUM_LIQUIDITY;
+            if (_totalSupply == 0) {
+                // First deposit - lock minimum liquidity
+                uint256 liquidity = sqrt(amount0 * amount1) - minLiquidity;
+                if (liquidity < minLiquidity) {
+                    revert("First deposit must be at least MINIMUM_LIQUIDITY");
+                }
+                _mint(to, liquidity);
+                _mint(address(0), minLiquidity);
+                return liquidity;
+            } else {
+                // Subsequent deposits
+                uint256 liquidity = _mintLPTokens(amount0, amount1, to);
+                return liquidity;
+            }
+        }
 
-        _mint(to, amount);
+        _mint(to, amount);
 
-        function _mint(address to, uint256 amount) internal {
-            _balances[to] += amount;
-            totalSupply += amount;
-        }
+        function _mint(address to, uint256 amount) internal {
+            _balances[to] += amount;
+            totalSupply += amount;
+        }
 
-        function _burn(address from, uint256 amount) internal {
-            _balances[from] -= amount;
-            totalSupply -= amount;
-        }
+        function _burn(address from, uint256 amount) internal {
