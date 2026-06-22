// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    // FIX: Added minimum liquidity lock to prevent first-depositor manipulation
    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            // FIX: Lock minimum liquidity to address(0)
            lpTokens = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
            require(lpTokens > 0, "Insufficient liquidity for minimum lock");
            _mint(address(0), MINIMUM_LIQUIDITY);
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

    // FIX: Uses internal reserves instead of balanceOf
    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // FIX: Use reserveA/reserveB, not balanceOf
        uint256 _reserveA = reserveA;
        uint256 _reserveB = reserveB;

        amountA = lpTokens * _reserveA / totalSupply();
        amountB = lpTokens * _reserveB / totalSupply();

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
