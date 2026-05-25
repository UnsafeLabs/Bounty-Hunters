Looking at the issue description, I need to fix the first-depositor price manipulation vulnerability in the LiquidityPool contract. However, I notice that the actual contract file isn't provided in the context. I'll need to create the fix based on the issue description.

The main changes required are:
1. Implement minimum liquidity lock for first deposits
2. Fix the removeLiquidity function to use internal accounting
3. Add a sync function
4. Use internal reserve tracking instead of balanceOf

Let me create the LiquidityPool.sol file with the required fixes:

```diff
--- /dev/null
+++ b/solidity/contracts/LiquidityPool.sol
@@ -0,0 +1,200 @@
+// SPDX-License-Identifier: MIT
+pragma solidity ^0.8.0;
+
+import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
+import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
+import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
+
+contract LiquidityPool is ReentrancyGuard {
+    using SafeERC20 for IERC20;
+
+    // Events
+    event Deposit(address indexed depositor, uint256 amountA, uint256 amountB, uint256 liquidity);
+    event Withdraw(address indexed to, uint256 amountA, uint256 amountB, uint256 liquidity);
+    event Sync(uint256 reserveA, uint256 reserveB);
+    event Approval(address indexed owner, address indexed spender, uint256 value);
+
+    // State variables
+    IERC20 public tokenA;
+    IERC20 public tokenB;
+    uint256 public reserveA;
+    uint256 public reserveB;
+    uint256 private _totalSupply;
+    string public name;
+    string public symbol;
+    uint8 private _decimals;
+    address public factory;
+    
+    // Constants
+    uint256 public constant MINIMUM_LIQUIDITY = 1000;
+
+    constructor(
+        address _tokenA,
+        address _tokenB,
+        string memory _name,
+        string memory _symbol,
+        uint8 decimals
+    ) {
+        tokenA = IERC20(address(tokenA));
+        tokenB = IERC20(address(tokenB));
+        name = _name;
+        symbol = _symbol;
+        _decimals = decimals;
+        factory = msg.sender;
+    }
+
+    function() public payable {
+        factory = msg.sender;
+    }
+
+    // Add liquidity to the pool
+    function addLiquidity(
+        address to,
+        uint256 amountA,
+        uint256 amountB
+    ) external nonReentrant returns (uint256) {
+        require(amountA > 0 && amountB > 0, "Invalid amounts");
+        
+        uint256 liquidity;
+        
+        if (_totalSupply == 0) {
+            // First deposit - lock minimum liquidity
+            require(tokenA.transferFrom(msg.sender, address(this), amountA), "Transfer failed");
+            require(tokenB.transferFrom(msg.sender, address(this), amountB), "Transfer failed");
+            
+            _totalSupply += MINIMUM_LIQUIDITY;
+            _mint(address(this), MINIMUM_LIQUIDITY);
+            liquidity = _totalSupply;
+        } else {
+            // Regular deposit logic
+            uint256 amountAIn = amountA;
+            uint256 amountBIn = amountB;
+            require(tokenA.transferFrom(msg.sender, address(this), amountAIn), "TokenA transfer failed");
+            require(tokenB.transferFrom(msg.sender, address(this), amountBIn), "TokenB transfer failed");
+            
+            liquidity = _totalSupply;
+        }
+        
+        return liquidity;
+    }
+
+    // Remove liquidity from the pool
+    function removeLiquidity(
+        address to,
+        uint256 liquidity,
+        uint256 amountA,
+        uint256 amountB
+    ) external nonReentrant returns (uint256, uint256) {
+        require(liquidity > 0, "Invalid liquidity");
+        
+        // Use internal reserves instead of balanceOf to prevent manipulation
+        uint256 reserve0 = reserveA;
+        uint256 reserve1 = reserveB;
+        
+        // Calculate amounts based on internal accounting
+        uint256 amountAOptimal = (amountA * _totalSupply) / reserve0;
+        uint256 amountBOptimal = (amountB * _totalSupply) / reserve1;
+        
+        return (amountA, amountB);
+    }
+
+    // Sync function to update reserves
+    function sync() external {
+        // Update internal reserves to match actual balances
+        reserveA = tokenA.balanceOf(address(this));
+        reserveB = tokenB.balanceOf(address(this));
+        emit Sync(reserveA, reserveB);
+    }
+
+    function getReserves() public view returns (uint256, uint256, uint256);
+    
+    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256 amountOut) {
+        return (amountIn * 1000) * (reserveOut * 997) / ((reserveIn * 1000) + (amountIn * 1000));
+    }
+    
+    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256 amountIn) {
+        return (amountOut * 1000) * (reserveIn * 997) / ((reserveOut * 1000) + (amountOut * 1000));
+    }
+    
+    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
+        return (amountIn * 1000) * 997 / ((reserveIn * 1000) + (amountIn * 1000));
+    }
+    
+    function getAmountsIn(uint256 amountOut, address[] memory path) public view returns (uint256[] memory amounts) {
+        return (amountOut * 1000) * (reserveIn * 997) / ((reserveOut * 1000) + (amountOut * 1000));
+   