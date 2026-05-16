// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract LiquidityPool {
    uint256 public reserve0; uint256 public reserve1;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1);
    event Swap(address indexed sender, uint256 amountIn, uint256 amountOut, bool zeroForOne);
    function mint(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            require(liquidity > 0, "First deposit too small");
            balanceOf[address(0)] = MINIMUM_LIQUIDITY;
        } else {
            liquidity = min((amount0 * _totalSupply) / reserve0, (amount1 * _totalSupply) / reserve1);
        }
        require(liquidity > 0, "Insufficient liquidity minted");
        balanceOf[msg.sender] += liquidity;
        totalSupply = _totalSupply + liquidity;
        reserve0 += amount0; reserve1 += amount1;
        emit Mint(msg.sender, amount0, amount1);
    }
    function burn(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
        require(balanceOf[msg.sender] >= liquidity, "Insufficient balance");
        amount0 = (liquidity * reserve0) / totalSupply;
        amount1 = (liquidity * reserve1) / totalSupply;
        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity burned");
        balanceOf[msg.sender] -= liquidity;
        totalSupply -= liquidity;
        reserve0 -= amount0; reserve1 -= amount1;
        emit Burn(msg.sender, amount0, amount1);
    }
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }
    function min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
}