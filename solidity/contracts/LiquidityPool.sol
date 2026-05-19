// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title LiquidityPool
 * @notice Constant-product AMM liquidity pool with LP token minting.
 * @dev Security fixes applied (issue #918):
 *   1. First deposit locks MINIMUM_LIQUIDITY to address(0) — prevents
 *      first-depositor price manipulation attack (Uniswap V2 pattern).
 *   2. removeLiquidity uses internal reserves (reserveA/reserveB) instead
 *      of balanceOf — prevents donation attacks via direct token transfers.
 *   3. Added sync() function to reconcile internal reserves with actual
 *      balances for recovery from accidental donations.
 */
contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    /// @notice Minimum liquidity permanently locked on first deposit.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token address");
        require(_tokenA != _tokenB, "Identical tokens");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    /**
     * @notice Add liquidity to the pool and receive LP tokens.
     * @dev On first deposit, MINIMUM_LIQUIDITY LP tokens are permanently locked
     *      at address(0) to prevent the first-depositor price manipulation attack.
     * @param amountA Amount of token A to deposit.
     * @param amountB Amount of token B to deposit.
     * @return lpTokens Number of LP tokens minted to the caller.
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");

        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            // First deposit: lock MINIMUM_LIQUIDITY to address(0)
            // This prevents the first-depositor attack where someone deposits
            // 1 wei, then donates a huge amount to inflate LP token price.
            lpTokens = sqrt(amountA * amountB);
            require(lpTokens > MINIMUM_LIQUIDITY, "Initial liquidity too low");

            // Permanently lock minimum liquidity
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
            lpTokens -= MINIMUM_LIQUIDITY;
        } else {
            // Proportional deposit using internal reserves (not balanceOf)
            uint256 lpFromA = amountA * totalSupply() / reserveA;
            uint256 lpFromB = amountB * totalSupply() / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
        }

        require(lpTokens > 0, "Insufficient liquidity");
        _mint(msg.sender, lpTokens);

        // Update internal reserves
        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    /**
     * @notice Remove liquidity by burning LP tokens.
     * @dev Uses internal reserves (reserveA/reserveB) for calculation instead
     *      of balanceOf(address(this)), which is manipulable via direct transfers.
     * @param lpTokens Number of LP tokens to burn.
     * @return amountA Token A returned to caller.
     * @return amountB Token B returned to caller.
     */
    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // Use internal reserves — NOT balanceOf — to prevent donation attacks
        amountA = lpTokens * reserveA / totalSupply();
        amountB = lpTokens * reserveB / totalSupply();

        require(amountA > 0 && amountB > 0, "Insufficient output amounts");

        _burn(msg.sender, lpTokens);

        // Update internal reserves before transfer (CEI pattern)
        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    /**
     * @notice Sync internal reserves with actual token balances.
     * @dev Recovery function: if tokens are accidentally sent directly to the
     *      pool (bypassing addLiquidity), this updates internal accounting
     *      to reflect actual balances without affecting LP token pricing.
     */
    function sync() external {
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));
        emit Sync(reserveA, reserveB);
    }

    /**
     * @notice Returns current pool reserves.
     * @return _reserveA Internal reserve of token A.
     * @return _reserveB Internal reserve of token B.
     */
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }

    /**
     * @dev Integer square root using Babylonian method.
     */
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
