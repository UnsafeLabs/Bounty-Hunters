// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 private lockedMinimumLiquidity;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        require(_tokenA != address(0), "Invalid tokenA");
        require(_tokenB != address(0), "Invalid tokenB");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function totalSupply() public view override returns (uint256) {
        return super.totalSupply() + lockedMinimumLiquidity;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (account == address(0)) {
            return lockedMinimumLiquidity;
        }
        return super.balanceOf(account);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        require(amountA > 0 && amountB > 0, "Invalid amounts");
        require(tokenA.transferFrom(msg.sender, address(this), amountA), "TokenA transfer failed");
        require(tokenB.transferFrom(msg.sender, address(this), amountB), "TokenB transfer failed");

        uint256 currentSupply = totalSupply();

        if (currentSupply == 0) {
            uint256 liquidity = sqrt(amountA * amountB);
            require(liquidity > MINIMUM_LIQUIDITY, "Insufficient liquidity");
            lockedMinimumLiquidity = MINIMUM_LIQUIDITY;
            emit Transfer(address(0), address(0), MINIMUM_LIQUIDITY);
            lpTokens = liquidity - MINIMUM_LIQUIDITY;
        } else {
            uint256 lpFromA = amountA * currentSupply / reserveA;
            uint256 lpFromB = amountB * currentSupply / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
        }

        require(lpTokens > 0, "Insufficient liquidity");
        _mint(msg.sender, lpTokens);

        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
        emit Sync(reserveA, reserveB);
    }

    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        uint256 currentSupply = totalSupply();
        amountA = lpTokens * reserveA / currentSupply;
        amountB = lpTokens * reserveB / currentSupply;
        require(amountA > 0 && amountB > 0, "Insufficient reserves");

        _burn(msg.sender, lpTokens);

        require(tokenA.transfer(msg.sender, amountA), "TokenA transfer failed");
        require(tokenB.transfer(msg.sender, amountB), "TokenB transfer failed");

        reserveA -= amountA;
        reserveB -= amountB;

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
        emit Sync(reserveA, reserveB);
    }

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
