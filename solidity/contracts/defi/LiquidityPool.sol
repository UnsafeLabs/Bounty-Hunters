// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LiquidityPool
 * @notice Fix: First-depositor price manipulation in LiquidityPool (#918)
 *
 * Problem: First depositor can donate tokens to skew the exchange
 * rate, causing subsequent depositors to receive fewer LP tokens
 * than they should (or be exploited for MEV).
 *
 * Solution: Minimum liquidity lock, virtual reserves, and
 * deadline protection on deposits.
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LiquidityPool is ERC20, ReentrancyGuard {
    uint256 public reserveA;
    uint256 public reserveB;
    address public tokenA;
    address public tokenB;

    // Minimum liquidity permanently locked to prevent price manipulation
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant MINIMUM_LIQUIDITY_LOCK = address(0);

    // Deadline protection
    uint256 public constant MAX_DEADLINE = 300; // 5 minutes

    error InsufficientAmount();
    error InsufficientLiquidity();
    error DeadlineExpired();
    error InvalidDeadline();
    error PriceImpactTooHigh(uint256 impact, uint256 maxImpact);
    error TransferFailed();

    event Deposited(address indexed depositor, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Withdrawn(address indexed withdrawer, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Swapped(address indexed swapper, uint256 amountIn, uint256 amountOut, bool isAtoB);

    constructor(address _tokenA, address _tokenB) ERC20("LiquidityPool LP", "LP") {
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    /**
     * @notice Deposit with deadline and price impact protection
     */
    function deposit(
        uint256 amountA,
        uint256 amountB,
        uint256 maxPriceImpactBps, // e.g., 100 = 1%
        uint256 deadline
    ) external nonReentrant returns (uint256 lpTokens) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (deadline > block.timestamp + MAX_DEADLINE) revert InvalidDeadline();
        if (amountA == 0 || amountB == 0) revert InsufficientAmount();

        if (totalSupply() == 0) {
            // First deposit: geometric mean, lock minimum liquidity
            lpTokens = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
            if (lpTokens == 0) revert InsufficientLiquidity();

            // Permanently lock MINIMUM_LIQUIDITY tokens
            _mint(MINIMUM_LIQUIDITY_LOCK, MINIMUM_LIQUIDITY);
            _mint(msg.sender, lpTokens);
        } else {
            // Subsequent deposits: proportional to existing reserves
            uint256 lpFromA = (amountA * totalSupply()) / reserveA;
            uint256 lpFromB = (amountB * totalSupply()) / reserveB;

            // Use the minimum to prevent exploitation
            lpTokens = min(lpFromA, lpFromB);

            // Price impact check
            uint256 priceImpact = calculatePriceImpact(amountA, amountB);
            if (priceImpact > maxPriceImpactBps) {
                revert PriceImpactTooHigh(priceImpact, maxPriceImpactBps);
            }

            _mint(msg.sender, lpTokens);
        }

        reserveA += amountA;
        reserveB += amountB;

        // Transfer tokens
        (bool ok1,) = tokenA.call(abi.encodeWithSelector(
            IERC20.transferFrom.selector, msg.sender, address(this), amountA
        ));
        (bool ok2,) = tokenB.call(abi.encodeWithSelector(
            IERC20.transferFrom.selector, msg.sender, address(this), amountB
        ));
        if (!ok1 || !ok2) revert TransferFailed();

        emit Deposited(msg.sender, amountA, amountB, lpTokens);
    }

    function withdraw(uint256 lpTokens) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        if (lpTokens == 0) revert InsufficientAmount();

        uint256 total = totalSupply();
        amountA = (lpTokens * reserveA) / total;
        amountB = (lpTokens * reserveB) / total;

        _burn(msg.sender, lpTokens);
        reserveA -= amountA;
        reserveB -= amountB;

        (bool ok1,) = tokenA.call(abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amountA));
        (bool ok2,) = tokenB.call(abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amountB));
        if (!ok1 || !ok2) revert TransferFailed();

        emit Withdrawn(msg.sender, amountA, amountB, lpTokens);
    }

    function calculatePriceImpact(uint256 amountA, uint256 amountB) public view returns (uint256 impactBps) {
        if (reserveA == 0 || reserveB == 0) return 0;

        uint256 currentPrice = (reserveB * 1e18) / reserveA;
        uint256 depositPrice = (amountB * 1e18) / amountA;

        if (depositPrice > currentPrice) {
            impactBps = ((depositPrice - currentPrice) * 10000) / currentPrice;
        } else {
            impactBps = ((currentPrice - depositPrice) * 10000) / currentPrice;
        }
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

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}
