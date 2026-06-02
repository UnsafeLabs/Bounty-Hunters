// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    /// @notice Minimum liquidity permanently locked to address(0) on first deposit.
    ///         Prevents first-depositor share-price manipulation (Uniswap V2 pattern).
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        require(amountA > 0 && amountB > 0, "Both amounts must be > 0");

        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            // First depositor: LP tokens = sqrt(amountA * amountB), minus MINIMUM_LIQUIDITY
            // locked to address(0) to make share-price manipulation uneconomical.
            lpTokens = sqrt(amountA * amountB);
            require(lpTokens > MINIMUM_LIQUIDITY, "Insufficient first-deposit liquidity");
            // Permanently lock MINIMUM_LIQUIDITY to address(0) so it can never be withdrawn
            _mint(address(0), MINIMUM_LIQUIDITY);
            lpTokens -= MINIMUM_LIQUIDITY;
        } else {
            // Subsequent depositors: LP tokens proportional to existing supply & reserves.
            // Use the *current* reserves (not token balances) to prevent donation manipulation.
            uint256 lpFromA = amountA * totalSupply() / reserveA;
            uint256 lpFromB = amountB * totalSupply() / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
        }

        require(lpTokens > 0, "Insufficient liquidity minted");
        _mint(msg.sender, lpTokens);

        // Update reserves from actual token balances to account for any direct donations.
        // This ensures the reserve tracking stays consistent with the actual pool state
        // and subsequent depositors are priced fairly against real balances.
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // Use reserves (not live balances) for withdrawal calculation to prevent
        // donation-based manipulation — donors' tokens are captured in reserves
        // via the addLiquidity reserve sync, so they're shared proportionally.
        amountA = lpTokens * reserveA / totalSupply();
        amountB = lpTokens * reserveB / totalSupply();

        require(amountA > 0 && amountB > 0, "Insufficient liquidity burned");

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
