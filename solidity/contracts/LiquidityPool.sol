+ uint256 public constant MINIMUM_LIQUIDITY = 1000;
+ uint256 private _reserve0;
+ uint256 private _reserve1;
+ event Sync(uint256 reserve0, uint256 reserve1);

  constructor(address token0_, address token1_) {
      token0 = token0_;
      token1 = token1_;
+     _reserve0 = 0;
+     _reserve1 = 0;
  }

  function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
      IERC20(token0).transferFrom(msg.sender, address(this), amount0);
      IERC20(token1).transferFrom(msg.sender, address(this), amount1);
-     uint256 balance0 = IERC20(token0).balanceOf(address(this));
-     uint256 balance1 = IERC20(token1).balanceOf(address(this));
-     uint256 totalSupply = totalSupply();
+     uint256 balance0 = _reserve0 + amount0;
+     uint256 balance1 = _reserve1 + amount1;
+     uint256 _totalSupply = totalSupply();

-     if (totalSupply == 0) {
-         liquidity = sqrt(balance0 * balance1);
+     if (_totalSupply == 0) {
+         liquidity = sqrt(balance0 * balance1) - MINIMUM_LIQUIDITY;
+         _mint(address(0), MINIMUM_LIQUIDITY);
      } else {
-         liquidity = min((balance0 * totalSupply) / _reserve0, (balance1 * totalSupply) / _reserve1);
+         liquidity = min((balance0 * _totalSupply) / _reserve0, (balance1 * _totalSupply) / _reserve1);
      }
+     require(liquidity > 0, "LiquidityPool: INSUFFICIENT_LIQUIDITY_MINTED");
      _mint(msg.sender, liquidity);
+     _reserve0 = balance0;
+     _reserve1 = balance1;
+     emit Sync(_reserve0, _reserve1);
  }

  function removeLiquidity(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
-     uint256 balance0 = IERC20(token0).balanceOf(address(this));
-     uint256 balance1 = IERC20(token1).balanceOf(address(this));
-     uint256 totalSupply = totalSupply();
+     uint256 _totalSupply = totalSupply();
-     amount0 = (liquidity * balance0) / totalSupply;
-     amount1 = (liquidity * balance1) / totalSupply;
+     amount0 = (liquidity * _reserve0) / _totalSupply;
+     amount1 = (liquidity * _reserve1) / _totalSupply;
      require(amount0 > 0 && amount1 > 0, "LiquidityPool: INSUFFICIENT_LIQUIDITY_BURNED");
      _burn(msg.sender, liquidity);
      IERC20(token0).transfer(msg.sender, amount0);
      IERC20(token1).transfer(msg.sender, amount1);
+     _reserve0 = IERC20(token0).balanceOf(address(this));
+     _reserve1 = IERC20(token1).balanceOf(address(this));
+     emit Sync(_reserve0, _reserve1);
  }

+ function sync() external {
+     _reserve0 = IERC20(token0).balanceOf(address(this));
+     _reserve1 = IERC20(token1).balanceOf(address(this));
+     emit Sync(_reserve0, _reserve1);
+ }