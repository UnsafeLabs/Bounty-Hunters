// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title LiquidityPool
 * @dev A simple liquidity pool for demonstrating LP token mechanics
contract LiquidityPool is ERC20 {
    IERC20 public tokenA;
    IERC20 public tokenB;
    address public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    
    event Sync(uint256 reserveA, uint256 reserveB);
    event Mint(address indexed sender, uint256 amountA, uint256 amountB);
    event Burn(address indexed sender, uint256 amountA, uint256 amountB, address indexed to);
    event Transfer(address indexed from, address indexed to, uint256 value);
    
    constructor(address _tokenA, address _tokenB) {
        tokenA = _tokenA;

    }
    
    /**
     * @dev Internal function to mint LP tokens
     */
    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
    
    /**
     * @dev Internal function to burn LP tokens
     */
    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
    
    /**
     * @dev Update reserves to match actual balances
     */
    function sync() external {
        reserveA = IERC20(tokenA).balanceOf(address(this));
        reserveB = IERC20(tokenB).balanceOf(address(this));
        emit Sync(reserveA, reserveB);
    }
    
    /**
     * @dev Add liquidity to the pool and receive LP tokens
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 liquidity) {
    }

        
        uint256 liquidity;
        if (totalSupply == 0) {
            liquidity = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
            require(liquidity > 0, "Insufficient initial liquidity");
            _mint(address(0), MINIMUM_LIQUIDITY);
        } else {
            liquidity = min((amountA * totalSupply) / reserveA, (amountB * totalSupply) / reserveB);
        }
        
        require(liquidity > 0, "Insufficient liquidity minted");
        
        _mint(msg.sender, liquidity);
        _updateReserves();
    }
    
    /**
     * @dev Update internal reserves based on current balances
     */
    function _updateReserves() internal {
        uint256 balanceA = IERC20(tokenA).balanceOf(address(this));
        uint256 balanceB = IERC20(tokenB).balanceOf(address(this));
        reserveA = balanceA;
        reserveB = balanceB;
        emit Sync(reserveA, reserveB);
    }
    
    /**
     * @dev Remove liquidity from the pool
     */
    function removeLiquidity(uint256 liquidity) external returns (uint256 amountA, uint256 amountB) {
        require(balanceOf[msg.sender] >= liquidity, "Insufficient LP balance");
        
        uint256 _totalSupply = totalSupply;
        amountA = (liquidity * reserveA) / _totalSupply;
        amountB = (liquidity * reserveB) / _totalSupply;
        
        require(amountA > 0 && amountB > 0, "Insufficient liquidity burned");
        
        _burn(msg.sender, liquidity);
        _updateReserves();
        
        IERC20(tokenA).transfer(msg.sender, amountA);
        IERC20(tokenB).transfer(msg.sender, amountB);
    }
    
    /**
     * @dev Calculate square root
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
    
    /**
     * @dev Calculate minimum of two values
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
        }

        require(lpTokens > 0, "Insufficient liquidity");
        _mint(msg.sender, lpTokens);

        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    // BUG: Uses balanceOf instead of internal reserves — manipulable via direct transfer
    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");

        // BUG: Should use reserveA/reserveB, not balanceOf
        uint256 balA = tokenA.balanceOf(address(this));
        uint256 balB = tokenB.balanceOf(address(this));

        amountA = lpTokens * balA / totalSupply();
        amountB = lpTokens * balB / totalSupply();

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
