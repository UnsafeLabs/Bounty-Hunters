// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool {
    IERC20 public token0;
    IERC20 public token1;
contract LiquidityPool is ERC20 {
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalSupply;
    
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    // BUG: No MINIMUM_LIQUIDITY lock — first depositor can manipulate LP price
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Reserves(uint256 reserve0, uint256 reserve1);
    event Sync(uint256 reserve0, uint256 reserve1);

    constructor(address _token0, address _token1) {
        token0 = IERC20(_token0);
        tokenA = IERC20(_tokenA);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "Mint to zero address");
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Burn amount exceeds balance");
        totalSupply -= amount;
        balanceOf[from] -= amount;
    }

    function _update(uint256 balance0, uint256 balance1) internal {
        reserve0 = balance0;
        reserve1 = balance1;
        emit Reserves(balance0, balance1);
    }

    function getReserves() public view returns (uint256 _reserve0, uint256 _reserve1) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }

    function _mintLP(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burnLP(address from, uint256 amount) internal {
        totalSupply -= amount;
        uint256 balance0 = token0.balanceOf(address(this));
        uint256 balance1 = token1.balanceOf(address(this));

        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity minted");

        uint256 _totalSupply = totalSupply;
        uint256 liquidity;

        require(lpTokens > 0, "Insufficient liquidity");
            liquidity = Math.sqrt(amount0 * amount1);
        } else {
            liquidity = Math.min(
                (amount0 * _totalSupply) / reserve0,
                (amount1 * _totalSupply) / reserve1
            );
        }

        require(liquidity > 0, "Insufficient liquidity minted");

        if (_totalSupply == 0) {
            require(liquidity >= MINIMUM_LIQUIDITY, "Insufficient initial liquidity");
            _mintLP(address(0), MINIMUM_LIQUIDITY);
            liquidity -= MINIMUM_LIQUIDITY;
        }

        _mintLP(msg.sender, liquidity);
        _update(balance0, balance1);

        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        return liquidity;
    }

    function removeLiquidity(uint256 liquidity, address to) public returns (uint256 amount0, uint256 amount1) {
        require(balanceOf[msg.sender] >= liquidity, "Insufficient LP balance");

        uint256 _totalSupply = totalSupply;
        amount0 = (liquidity * reserve0) / _totalSupply;


        require(amount0 > 0 && amount1 > 0, "Insufficient liquidity burned");

        _burnLP(msg.sender, liquidity);
        _update(reserve0 - amount0, reserve1 - amount1);

        token0.transfer(to, amount0);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }
        return (amount0, amount1);
    }

    function sync() public {
        uint256 balance0 = token0.balanceOf(address(this));
        uint256 balance1 = token1.balanceOf(address(this));
        _update(balance0, balance1);
        emit Sync(balance0, balance1);
    }

    function swap(address tokenIn, uint256 amountIn, address to) public {
        require(tokenIn == address(token0) || tokenIn == address(token1), "Invalid token");

                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

        emit Swap(msg.sender, amountIn, amountOut, tokenIn, to);
    }
}
