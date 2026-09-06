// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    // Minimum liquidity locked forever to prevent first-depositor price manipulation
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    // Tracks the locked liquidity (sent to address(0))
    uint256 private _lockedLiquidity = 0;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    /// @notice Add liquidity to the pool
    /// @return lpTokens Amount of LP tokens minted
    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            // First deposit: mint MINIMUM_LIQUIDITY and lock it to address(0)
            lpTokens = sqrt(amountA * amountB);
            require(lpTokens > MINIMUM_LIQUIDITY, "Insufficient liquidity minted");
            uint256 locked = lpTokens - MINIMUM_LIQUIDITY;
            _lockedLiquidity = MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY);
            lpTokens = lpTokens - MINIMUM_LIQUIDITY;
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

    /// @notice Remove liquidity from the pool
    /// @param lpTokens Amount of LP tokens to burn
    /// @return amountA Amount of tokenA received
    /// @return amountB Amount of tokenB received
    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // Use internal reserve accounting (not balanceOf) to prevent manipulation via direct transfers
        uint256 totalLp = totalSupply() - _lockedLiquidity;
        amountA = lpTokens * reserveA / totalLp;
        amountB = lpTokens * reserveB / totalLp;

        require(amountA > 0 && amountB > 0, "Insufficient liquidity burned");

        _burn(msg.sender, lpTokens);
        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    /// @notice Sync reserves with actual token balances (after external transfers)
    /// @dev Updates reserves to match current balances, burning any excess tokens as liquidity
    function sync() external {
        reserveA = tokenA.balanceOf(address(this)) - _lockedLiquidity;
        reserveB = tokenB.balanceOf(address(this)) - _lockedLiquidity;
        emit Sync(reserveA, reserveB);
    }

    /// @notice Get the current exchange rate
    /// @return uint256 The reserve ratio
    function getReserveRatio() external view returns (uint256) {
        if (reserveB == 0) return 0;
        return reserveA * 1e18 / reserveB;
    }

    /// @notice Square root using Babylonian method
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
