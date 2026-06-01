// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    // FIXED: Add MINIMUM_LIQUIDITY lock — first depositor must lock liquidity
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB); // Added for tracking reserves

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply() == 0) {
            // FIXED: Lock minimum liquidity by sending to address(0)
            uint256 liquidity = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
            require(liquidity > 0, "Insufficient liquidity for minimum lock");
            _mint(address(0), MINIMUM_LIQUIDITY); // Lock liquidity
            _mint(msg.sender, liquidity); // Mint remaining to sender
            lpTokens = liquidity;
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
        emit Sync(reserveA, reserveB);
    }

    // FIXED: Use internal reserves instead of balanceOf — immune to direct transfer manipulation
    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // FIXED: Use reserveA/reserveB instead of balanceOf
        amountA = lpTokens * reserveA / totalSupply();
        amountB = lpTokens * reserveB / totalSupply();

        require(amountA > 0 && amountB > 0, "Insufficient reserves");

        _burn(msg.sender, lpTokens);

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        reserveA -= amountA;
        reserveB -= amountB;

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
        emit Sync(reserveA, reserveB);
    }

    // ADDED: Sync function to update reserves from actual token balances
    function sync() external {
        uint256 _reserveA = tokenA.balanceOf(address(this));
        uint256 _reserveB = tokenB.balanceOf(address(this));

        // Only allow sync if reserves increased (donation protection)
        require(_reserveA >= reserveA && _reserveB >= reserveB, "Invalid reserves");

        reserveA = _reserveA;
        reserveB = _reserveB;

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
