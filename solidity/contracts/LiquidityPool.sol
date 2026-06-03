// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LiquidityPool
 * @notice AMM liquidity pool with first-depositor attack protection
 * @dev Fixes:
 *   - MINIMUM_LIQUIDITY lock at address(0) prevents first-depositor manipulation
 *   - Internal reserves instead of balanceOf prevents direct transfer attacks
 *   - sync() function to recover from donation attacks
 *   - SafeERC20 for all transfers
 *   - ReentrancyGuard on all external functions
 */
contract LiquidityPool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        require(_tokenA != address(0), "Invalid token A");
        require(_tokenB != address(0), "Invalid token B");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    /**
     * @notice Add liquidity to the pool
     * @param amountA Amount of token A
     * @param amountB Amount of token B
     * @return lpTokens Amount of LP tokens minted
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant returns (uint256 lpTokens) {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");

        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            lpTokens = sqrt(amountA * amountB);
            require(lpTokens > MINIMUM_LIQUIDITY, "Insufficient initial liquidity");
            // Lock MINIMUM_LIQUIDITY at address(0) — prevents first-depositor manipulation
            _mint(address(0), MINIMUM_LIQUIDITY);
            lpTokens -= MINIMUM_LIQUIDITY;
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

    /**
     * @notice Remove liquidity from the pool
     * @param lpTokens Amount of LP tokens to burn
     * @return amountA Amount of token A returned
     * @return amountB Amount of token B returned
     */
    function removeLiquidity(uint256 lpTokens) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // Use internal reserves instead of balanceOf — prevents direct transfer manipulation
        amountA = lpTokens * reserveA / totalSupply();
        amountB = lpTokens * reserveB / totalSupply();

        _burn(msg.sender, lpTokens);

        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        reserveA -= amountA;
        reserveB -= amountB;

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    /**
     * @notice Sync reserves with actual token balances
     * @dev Use only if reserves drift due to direct transfers (donation attack recovery)
     */
    function sync() external nonReentrant {
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));
    }

    /**
     * @notice Get reserves
     * @return _reserveA Reserve of token A
     * @return _reserveB Reserve of token B
     */
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
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
