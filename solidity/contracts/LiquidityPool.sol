// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    // BUG: No MINIMUM_LIQUIDITY lock — first depositor can manipulate LP price
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            // BUG: No minimum liquidity lock to address(0)
            lpTokens = sqrt(amountA * amountB);
        } else {
            uint256 lpFromA = amountA * totalSupply() / reserveA;
            uint256 lpFromB = amountB * totalSupply() / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
        }

        require(lpTokens > 0, "Insufficient liquidity");
        _mint(msg.sender, lpTokens);

        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    // BUG: Uses balanceOf instead of internal reserves — manipulable via direct transfer
    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // BUG: Should use reserveA/reserveB, not balanceOf
        uint256 balA = tokenA.balanceOf(address(this));
        uint256 balB = tokenB.balanceOf(address(this));

        amountA = lpTokens * balA / totalSupply();
        amountB = lpTokens * balB / totalSupply();

        _burn(msg.sender, lpTokens);

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        reserveA -= amountA;
        reserveB -= amountB;

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LiquidityPool {
    // Implementation of the liquidity pool with protection against first-depositor price manipulation
    
    uint256 private constant MINIMUM_LIQUIDITY = 1000;
    
    // Pool state variables
    uint256 public totalLiquidity;
    uint256 public liquidityBalance;
    
    // Internal accounting variables to track actual reserves
    uint256 internal reserve0;
    uint255 internal reserve1;
    
    // Events
    event Sync(uint256 reserve0, uint256 reserve1);
    event AddLiquidity(
        address indexed sender,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );
    
    // Mint and burn events
    event Mint(address indexed to, uint256 amount0, uint2.{{A0711}};  // Truncated for space
}
