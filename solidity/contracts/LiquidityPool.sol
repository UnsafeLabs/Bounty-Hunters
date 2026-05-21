// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    // BUG: No MINIMUM_LIQUIDITY lock — first depositor can manipulate LP price
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant MAX_BALANCE_RATIO = 500;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB);


    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    modifier ensure(uint256 deadline) {
        require(block.timestamp <= deadline, "Expired");
        _;
    }

    function addLiquidity(uint256 amountA, uint256 amountB, uint256 deadline) external ensure(deadline) returns (uint256 lpTokens) {
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

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

        _sync();
        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    // BUG: Uses balanceOf instead of internal reserves — manipulable via direct transfer
    function removeLiquidity(uint256 lpTokens, uint256 deadline) external ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // BUG: Should use reserveA/reserveB, not balanceOf
        uint256 balA = tokenA.balanceOf(address(this));
        uint256 balB = tokenB.balanceOf(address(this));

        amountA = lpTokens * balA / totalSupply();
        amountB = lpTokens * balB / totalSupply();

        _burn(msg.sender, lpTokens);

        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        reserveA -= amountA;
        reserveB -= amountB;

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, uint256 deadline) external ensure(deadline) returns (uint256 amountOut) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, , ) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        uint256 balanceIn = inputToken.balanceOf(address(this));
        uint256 balanceOut = outputToken.balanceOf(address(this));

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 newBalanceIn = inputToken.balanceOf(address(this));
        uint256 newBalanceOut = outputToken.balanceOf(address(this));

        uint256 amountInReal = newBalanceIn - balanceIn;
        uint256 amountOutReal = balanceOut - newBalanceOut;

        uint256 feeAmount = amountInReal * 30 / 10000;
        uint256 amountInAfterFee = amountInReal - feeAmount;

        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;

        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
        require(amountOut >= minAmountOut, "Slippage too high");

        outputToken.safeTransfer(msg.sender, amountOut);

        _sync();

        emit Swap(msg.sender, tokenIn, amountInReal, amountOut);
    }

    function _sync() internal {
        uint256 balA = tokenA.balanceOf(address(this));
        uint256 balB = tokenB.balanceOf(address(this));
        require(
            balA >= reserveA * (10000 - MAX_BALANCE_RATIO) / 10000 &&
            balA <= reserveA * (10000 + MAX_BALANCE_RATIO) / 10000 &&
            balB >= reserveB * (10000 - MAX_BALANCE_RATIO) / 10000 &&
            balB <= reserveB * (10000 + MAX_BALANCE_RATIO) / 10000,
            "Balance ratio exceeded"
        );
        reserveA = balA;
        reserveB = balB;
        emit Sync(reserveA, reserveB);
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
