+ // SPDX-License-Identifier: MIT
+ pragma solidity ^0.8.0;
+ 
+ import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
+ import "@openzeppelin/contracts/access/Ownable.sol";
+ 
+ contract LiquidityPool is ERC20, Ownable {
+     IERC20 public token0;
+     IERC20 public token1;
+ 
+     uint256 public reserve0;
+     uint256 public reserve1;
+ 
+     uint256 public constant MINIMUM_LIQUIDITY = 1000;
+ 
+     event Mint(address indexed sender, uint256 amount0, uint256 amount1);
+     event Burn(address indexed sender, uint256 amount0, uint256 amount1);
+     event Sync(uint256 reserve0, uint256 reserve1);
+ 
+     constructor(address _token0, address _token1) ERC20("LiquidityPool", "LP") {
+         token0 = IERC20(_token0);
+         token1 = IERC20(_token1);
+     }
+ 
+     function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
+         bool isFirstDeposit = totalSupply() == 0;
+ 
+-        if (isFirstDeposit) {
+-            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
+-            _mint(address(0), MINIMUM_LIQUIDITY);
+-        } else {
+-            uint256 amount0Min = (amount1 * reserve0) / reserve1;
+-            uint256 amount1Min = (amount0 * reserve1) / reserve0;
+-            liquidity = Math.min(
+-                (amount0 * totalSupply()) / reserve0,
+-                (amount1 * totalSupply()) / reserve1
+-            );
+-        }
++        if (isFirstDeposit) {
++            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
++            _mint(address(0), MINIMUM_LIQUIDITY);
++        } else {
++            uint256 amount0Min = (amount1 * reserve0) / reserve1;
++            uint256 amount1Min = (amount0 * reserve1) / reserve0;
++            liquidity = Math.min(
++                (amount0 * totalSupply()) / reserve0,
++                (amount1 * totalSupply()) / reserve1
++            );
++        }
+ 
+         require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
+ 
+         token0.transferFrom(msg.sender, address(this), amount0);
+         token1.transferFrom(msg.sender, address(this), amount1);
+ 
+         reserve0 = token0.balanceOf(address(this));
+         reserve1 = token1.balanceOf(address(this));
+ 
+         emit Mint(msg.sender, amount0, amount1);
+         emit Sync(reserve0, reserve1);
+     }
+ 
+     function removeLiquidity(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
+         require(liquidity > 0, "INSUFFICIENT_LIQUIDITY");
+         require(balanceOf(msg.sender) >= liquidity, "INSUFFICIENT_BALANCE");
+ 
+-        amount0 = (liquidity * reserve0) / totalSupply();
+-        amount1 = (liquidity * reserve1) / totalSupply();
++        amount0 = (liquidity * reserve0) / totalSupply();
++        amount1 = (liquidity * reserve1) / totalSupply();
+ 
+         _burn(msg.sender, liquidity);
+ 
+         token0.transfer(msg.sender, amount0);
+         token1.transfer(msg.sender, amount1);
+ 
+         reserve0 = token0.balanceOf(address(this));
+         reserve1 = token1.balanceOf(address(this));
+ 
+         emit Burn(msg.sender, amount0, amount1);
+         emit Sync(reserve0, reserve1);
+     }
+ 
+     function sync() external {
+         reserve0 = token0.balanceOf(address(this));
+         reserve1 = token1.balanceOf(address(this));
+         emit Sync(reserve0, reserve1);
+     }
+ }