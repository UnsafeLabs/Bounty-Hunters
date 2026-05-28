// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    // Minimum liquidity locked to address(0) to prevent first-depositor price manipulation
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    error InsufficientLiquidity();
    error InsufficientLPTokens();
    error ZeroAmount();

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
            lpTokens = sqrt(amountA * amountB);
            // Fix: Lock minimum liquidity to address(0) to prevent first-depositor manipulation
            // This ensures the pool always has some liquidity and prevents price manipulation
            _mint(address(1), MINIMUM_LIQUIDITY); // address(1) as dead address (like Uniswap)
            lpTokens -= MINIMUM_LIQUIDITY;
        } else {
            uint256 lpFromA = amountA * totalSupply() / reserveA;
            uint256 lpFromB = amountB * totalSupply() / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
        }

        if (lpTokens == 0) {
            revert InsufficientLiquidity();
        }
        _mint(msg.sender, lpTokens);

        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    // Fix: Use internal reserves instead of balanceOf to prevent manipulation via direct transfer
    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        if (lpTokens == 0) {
            revert ZeroAmount();
        }
        if (balanceOf(msg.sender) < lpTokens) {
            revert InsufficientLPTokens();
        }

        // Use internal reserves instead of balanceOf to prevent manipulation
        amountA = lpTokens * reserveA / totalSupply();
        amountB = lpTokens * reserveB / totalSupply();

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
}
