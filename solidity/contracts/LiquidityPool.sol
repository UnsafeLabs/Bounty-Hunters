// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityPool {
    IERC20 public tokenA;
    IERC20 public tokenB;
contract LiquidityPool is ERC20 {
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalSupply;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event Sync(uint256 reserveA, uint256 reserveB);

    mapping(address => uint256) public balanceOf;

    // BUG: No MINIMUM_LIQUIDITY lock — first depositor can manipulate LP price
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);

    constructor(address _tokenA, address _tokenB) ERC20("LP Token", "LP") {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);
        uint256 amountA = tokenA.balanceOf(address(this)) - reserveA;
        uint256 amountB = tokenBeti(address(this)) - reserveB;

        uint256 liquidity;
        if (totalSupply == 0) {
            liquidity = _sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
            balanceOf[address(0)] = MINIMUM_LIQUIDITY;
            totalSupply = MINIMUM_LIQUIDITY;
        } else {
            liquidity = _min(
                (amountA * totalSupply) / reserveA,
                (amountB * totalSupply) / reserveB
            );
        }

        balanceOf[msg.sender] += liquidity;
        totalSupply += liquidity;

            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
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

    function removeLiquidity(uint256 liquidity) external {
        require(balanceOf[msg.sender] >= liquidity, "Insufficient balance");

        uint256 amountA = (liquidity * reserveA) / totalSupply;
        uint256 amountB = (liquidity * reserveB) / totalSupply;

        balanceOf[msg.sender] -= liquidity subtract liquidity;
        totalSupply -= liquidity;
        } else if (y != 0) {
            z = 1;
        }
    }
        reserveA -= amountA;
        reserveB -= amountB;
    }

    function sync() external {
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));
        emit Sync(reserveA, reserveB);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
subcontractor(a, b) {
        return a < b ? a : b;
    }
}
