Looking at the issue description, I need to fix the LiquidityPool.sol contract to prevent first-depositor price manipulation. Let me create the necessary Solidity contract file and the generation.json file.

```diff
--- /dev/null
+++ b/solidity/contracts/LiquidityPool.sol
@@ -0,0 +1,224 @@
+// SPDX-License-Identifier: MIT
+pragma solidity ^0.8.0;
+
+import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
+import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
+import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
+
+contract LiquidityPool is ERC20, ReentrancyGuard {
+    uint256 private constant MINIMUM_LIQUIDITY = 1000;
+    
+    address public tokenA;
+    address public tokenB;
+    address public factory;
+    
+    uint112 private reserveA;
+    uint112 private reserveB;
+    uint32  private blockTimestampLast;
+    
+    // Events
+    event Mint(address indexed sender, uint amountA, uint amountB);
+    event Burn(address indexed sender, uint amountA, uint amountB, address indexed to);
+    event Swap(
+        address indexed sender,
+        uint amountAIn,
+        uint amountBIn,
+        uint amountAOut,
+        uint amountBOut,
+        address indexed to
+    );
+    event Sync(uint112 reserveA, uint112 reserveB);
+    
+    constructor(
+        address _tokenA,
+        address _tokenB,
+        address _factory
+    ) ERC20("Liquidity Pool Token", "UNI-V2") {
+        tokenA = _tokenA;
+        tokenB = _tokenB;
+        factory = _factory;
+    }
+    
+    // Store reserves for the pair
+    function getReserves() public view returns (uint112, uint112, uint32) {
+        return (reserveA, reserveB, blockTimestampLast);
+    }
+    
+    // Update reserves to match current balances
+    function sync() external {
+        _update(IERC20(tokenA).balanceOf(address(this)), IERC20(tokenB).balanceOf(address(this)));
+        emit Sync(reserveA, reserveB);
+    }
+    
+    // Internal function to update reserves
+    function _update(uint balanceA, uint balanceB) private {
+        reserveA = uint112(balanceA);
+        reserveB = uint112(balanceB);
+        blockTimestampLast = uint32(block.timestamp);
+    }
+    
+    function mint(address to) external returns (uint liquidity) {
+        (uint112 _reserveA, uint112 _reserveB, ) = getReserves();
+        uint balanceA = IERC20(tokenA).balanceOf(address(this));
+        uint balanceB = IERC20(tokenB).balanceOf(address(this));
+        
+        uint amountA = balanceA - _reserveA;
+        uint amountB = balanceB - _reserveB;
+        
+        uint _totalSupply = totalSupply();
+        if (_totalSupply == 0) {
+            // First deposit - lock minimum liquidity
+            liquidity = (amountA * amountB) - MINIMUM_LIQUIDITY;
+            _mint(address(0), MINIMUM_LIQUIDITY);
+        } else {
+            liquidity = ((_totalSupply * amountA) / _reserveA + (_totalSupply * amountB) / _reserveB) / 2;
+        }
+        
+        require(liquidity > 0, 'LiquidityPool: INSUFFICIENT_LIQUIDITY_MINTED');
+        _mint(to, liquidity);
+        
+        _update(balanceA, balanceB);
+        emit Mint(msg.sender, amountA, amountB);
+    }
+    
+    function burn(address to) external returns (uint amountA, uint amountB) {
+        (uint112 _reserveA, uint112 _reserveB, ) = getReserves();
+        uint balanceA = IERC20(tokenA).balanceOf(address(this));
+        uint balanceB = IERC20(tokenB).balanceOf(address(this));
+        
+        uint liquidity = balanceOf(address(this));
+        amountA = (balanceA * liquidity) / totalSupply();
+        amountB = (balanceB * liquidity) / totalSupply();
+        
+        _burn(address(this), liquidity);
+        IERC20(tokenA).transfer(to, amountA);
+        IERC20(tokenB).transfer(to, amountB);
+        
+        _update(balanceA - amountA, balanceB - amountB);
+        emit Burn(msg.sender, amountA, amountB, to);
+    }
+    
+    function removeLiquidity(
+        uint liquidity,
+        address to
+    ) external returns (uint amountA, uint amountB) {
+        (uint112 _reserveA, uint112 _reserveB, ) = getReserves();
+        
+        uint balanceA = IERC20(tokenA).balanceOf(address(this));
+        uint balanceB = IERC20(tokenB).balanceOf(address(this));
+        
+        amountA = (liquidity * _reserveA) / totalSupply();
+        amountB = (liquidity * _reserveB) / totalSupply();
+        
+        _burn(msg.sender, liquidity);
+        IERC20(tokenA).transfer(to, amountA);
+        IERC20(tokenB).transfer(to, amountB);
+        
+        _update(balanceA - amountA, balanceB - amountB);
+        emit Burn(msg.sender, amountA, amountB, to);
+    }
+    
+    function swap(
+        uint amountAOut,
+        uint amountBOut,
+        address to
+    ) external {
+        (uint112 _reserveA, uint112 _reserveB, ) = getReserves();
+        require(to != tokenA && to != tokenB, "LiquidityPool: INVALID_TO");
+         
+        if (amountAOut > 0) IERC20(tokenB).transfer(to, amountAOut);
+        if (amountBOut > 0) IERC20(tokenA).transfer(to, amountBOut);
+        
+        uint balanceA = IERC20(tokenA).balanceOf(address(this));
+        uint balanceB = IERC20(tokenB).balanceOf(address(this));
+        
+        _update(balanceA, balanceB);
+        emit Swap(msg.sender, 0, 0, amountAOut, amountB0ut, to);
+   