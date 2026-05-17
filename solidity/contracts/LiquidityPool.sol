// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract LiquidityPool {
    uint256 public reserve0; uint256 public reserve1;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public feeBPS = 30;
    address public owner;
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1);
    event Swap(address indexed sender, uint256 amountIn, uint256 amountOut, bool zeroForOne);
    constructor() { owner = msg.sender; }
    function mint(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
        uint256 _ts = totalSupply;
        if (_ts == 0) {
            liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            require(liquidity > 0, "First deposit too small");
            balanceOf[address(0)] = MINIMUM_LIQUIDITY;
        } else {
            liquidity = min((amount0 * _ts) / reserve0, (amount1 * _ts) / reserve1);
        }
        require(liquidity > 0, "Insufficient liquidity minted");
        balanceOf[msg.sender] += liquidity;
        totalSupply = _ts + liquidity;
        reserve0 += amount0; reserve1 += amount1;
        emit Mint(msg.sender, amount0, amount1);
    }
    function burn(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
        require(balanceOf[msg.sender] >= liquidity, "Insufficient balance");
        uint256 _ts = totalSupply;
        amount0 = (liquidity * reserve0) / _ts;
        amount1 = (liquidity * reserve1) / _ts;
        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity burned");
        balanceOf[msg.sender] -= liquidity;
        totalSupply = _ts - liquidity;
        reserve0 -= amount0; reserve1 -= amount1;
        emit Burn(msg.sender, amount0, amount1);
    }
    function swap(uint256 amountIn, uint256 amountOutMin, bool zeroForOne) external returns (uint256 amountOut) {
        uint256 reserveIn = zeroForOne ? reserve0 : reserve1;
        uint256 reserveOut = zeroForOne ? reserve1 : reserve0;
        uint256 amountInWithFee = amountIn * (10000 - feeBPS);
        amountOut = (amountInWithFee * reserveOut) / (10000 * reserveIn + amountInWithFee);
        require(amountOut >= amountOutMin, "Slippage exceeded");
        if (zeroForOne) { reserve0 += amountIn; reserve1 -= amountOut; }
        else { reserve1 += amountIn; reserve0 -= amountOut; }
        emit Swap(msg.sender, amountIn, amountOut, zeroForOne);
    }
    function sync() external { reserve0 = IERC20(token0()).balanceOf(address(this)); reserve1 = IERC20(token1()).balanceOf(address(this)); }
    function setFee(uint256 _fee) external { require(msg.sender == owner); require(_fee <= MAX_FEE_BPS); feeBPS = _fee; }
    function token0() public pure returns (address) { return 0x0000000000000000000000000000000000000001; }
    function token1() public pure returns (address) { return 0x0000000000000000000000000000000000000002; }
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } }
        else if (y != 0) { z = 1; }
    }
    function min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }
}
interface IERC20 { function balanceOf(address) external view returns (uint256); }