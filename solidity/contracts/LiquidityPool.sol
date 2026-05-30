// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    // Minimum liquidity permanently locked on the first deposit so that
    // totalSupply can never be dust, which defeats first-depositor share
    // price manipulation. OZ ERC20 forbids minting to address(0), so the
    // shares are sent to a permanent dead address instead (same guarantee).
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            uint256 liquidity = sqrt(amountA * amountB);
            require(liquidity > MINIMUM_LIQUIDITY, "Insufficient liquidity");
            // Permanently lock MINIMUM_LIQUIDITY so the pool can never be
            // drained to a tiny totalSupply that enables price manipulation.
            _mint(DEAD, MINIMUM_LIQUIDITY);
            lpTokens = liquidity - MINIMUM_LIQUIDITY;
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

    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // Use internal reserves, not balanceOf, so tokens donated directly to
        // the pool cannot inflate withdrawal amounts.
        amountA = lpTokens * reserveA / totalSupply();
        amountB = lpTokens * reserveB / totalSupply();

        _burn(msg.sender, lpTokens);

        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    // Force reserves to match actual balances after a direct token transfer.
    function sync() external {
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));
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
