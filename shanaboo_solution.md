```diff
--- a/solidity/contracts/LiquidityPool.sol
+++ b/solidity/contracts/LiquidityPool.sol
@@ -1,6 +1,8 @@
 // SPDX-License-Identifier: MIT
 pragma solidity ^0.8.0;
 
+import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
+
 contract LiquidityPool {
     // Token addresses
     address public tokenA;
@@ -15,6 +17,12 @@ contract LiquidityPool {
     uint256 public totalSupply;
     mapping(address => uint256) public balanceOf;
 
+    // Minimum liquidity locked on first deposit (Uniswap V2 pattern)
+    uint256 public constant MINIMUM_LIQUIDITY = 1000;
+
+    // Internal reserves for manipulation-resistant accounting
+    uint256 internal _reserveA;
+    uint256 internal _reserveB;
+
     // Events
     event Mint(address indexed sender, uint256 amountA, uint256 amountB);
     event Burn(address indexed sender, uint256 amountA, uint256 amountB, address indexed to);
@@ -22,6 +30,7 @@ contract LiquidityPool {
     event Swap(address indexed sender, uint256 amountAIn, uint256 amountBIn, uint256 amountAOut, uint256 amountBOut, address indexed to);
     event Transfer(address indexed from, address indexed to, uint256 value);
     event Approval(address indexed owner, address indexed spender, uint256 value);
+    event Sync(uint256 reserveA, uint256 reserveB);
 
     constructor(address _tokenA, address _tokenB) {
         tokenA = _tokenA;
@@ -40,6 +49,11 @@ contract LiquidityPool {
         _;
     }
 
+    modifier nonZeroAmount(uint256 amount) {
+        require(amount > 0, "LiquidityPool: INSUFFICIENT_AMOUNT");
+        _;
+    }
+
     // Internal transfer helper
     function _transfer(address from, address to, uint256 value) internal {
         require(balanceOf[from] >= value, "LiquidityPool: INSUFFICIENT_BALANCE");
@@ -56,6 +70,12 @@ contract LiquidityPool {
         balanceOf[to] += value;
     }
 
+    // Update internal reserves to match actual balances (recovery from donation attacks)
+    function sync() external {
+        _reserveA = IERC20(tokenA).balanceOf(address(this));
+        _reserveB = IERC20(tokenB).balanceOf(address(this));
+        emit Sync(_reserveA, _reserveB);
+    }
+
     // Add liquidity to the pool
     function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 liquidity) {
         require(amountA > 0 && amountB > 0, "LiquidityPool: ZERO_AMOUNT");
@@ -63,14 +83,27 @@ contract LiquidityPool {
         // Transfer tokens from sender
         require(IERC20(tokenA).transferFrom(msg.sender, address(this), amountA), "LiquidityPool: TRANSFER_A_FAILED");
         require(IERC20(tokenB).transferFrom(msg.sender, address(this), amountB), "LiquidityPool: TRANSFER_B_FAILED");
 
-        uint256 _totalSupply = totalSupply;
-        if (_totalSupply == 0) {
-            // First deposit: liquidity is geometric mean
-            liquidity = sqrt(amountA * amountB);
+        uint256 _totalSupply = totalSupply;
+        if (_totalSupply == 0) {
+            // First deposit: liquidity is geometric mean, minus minimum liquidity lock
+            liquidity = sqrt(amountA * amountB);
+            require(liquidity > MINIMUM_LIQUIDITY, "LiquidityPool: INSUFFICIENT_INITIAL_LIQUIDITY");
+            liquidity -= MINIMUM_LIQUIDITY;
+            
+            // Lock minimum liquidity permanently by minting to address(0)
+            totalSupply = MINIMUM_LIQUIDITY;
+            balanceOf[address(0)] = MINIMUM_LIQUIDITY;
+            emit Transfer(address(0), address(0), MINIMUM_LIQUIDITY);
+            
+            // Mint remaining liquidity to sender
+            totalSupply += liquidity;
+            balanceOf[msg.sender] += liquidity;
+            emit Mint(msg.sender, amountA, amountB);
+            emit Transfer(address(0), msg.sender, liquidity);
         } else {
             // Subsequent deposits: proportional to existing liquidity
-            liquidity = min((amountA * _totalSupply) / IERC20(tokenA).balanceOf(address(this)), (amountB * _totalSupply) / IERC20(tokenB).balanceOf(address(this)));
+            uint256 liquidityA = (amountA * _totalSupply) / _reserveA;
+            uint256 liquidityB = (amountB * _totalSupply) / _reserveB;
+            liquidity = liquidityA < liquidityB ? liquidityA : liquidityB;
+            
+            totalSupply += liquidity;
+            balanceOf[msg.sender] += liquidity;
+            emit Mint(msg.sender, amountA, amountB);
+            emit Transfer(address(0), msg.sender, liquidity);
         }
 
-        require(liquidity > 0, "LiquidityPool: INSUFFICIENT_LIQUIDITY_MINTED");
-        balanceOf[msg.sender] += liquidity;
-        totalSupply += liquidity;
-        emit Mint(msg.sender, amountA, amountB);
+        // Update internal reserves
+        _reserveA = IERC20(tokenA).balanceOf(address(this));
+        _reserveB = IERC20(tokenB).balanceOf(address(this));
     }
 
     // Remove liquidity from the pool
-    function removeLiquidity(uint256 liquidity) external returns (uint256 amountA, uint256 amountB) {
+    function removeLiquidity(uint256 liquidity) external nonZeroAmount(liquidity) returns (uint256 amountA, uint256 amountB) {
         require(balanceOf[msg.sender] >= liquidity, "LiquidityPool: INSUFFICIENT_LIQUIDITY");
 
-        uint256 _totalSupply = totalSupply;
-        amountA = (liquidity * IERC20(tokenA).balanceOf(address(this))) / _totalSupply;
-        amountB = (liquidity * IERC20(tokenB).balanceOf(address(this))) / _totalSupply;
+        uint256 _totalSupply = totalSupply;
+        
+        // Use internal reserves instead of balanceOf to prevent manipulation via direct transfers
+        amountA = (liquidity * _reserveA) / _totalSupply;
+        amountB = (liquidity * _reserveB) / _totalSupply;
 
         balanceOf[msg.sender] -= liquidity;
-        totalSupply -= liquidity;
+        totalSupply = _totalSupply - liquidity;
 
         require(IERC20(tokenA).transfer(msg.sender, amountA), "LiquidityPool: TRANSFER_A_FAILED");
         require(IERC20(tokenB).transfer(msg.sender, amountB), "LiquidityPool: TRANSFER_B_FAILED");
 
         emit Burn(msg.sender, amountA, amountB, msg.sender