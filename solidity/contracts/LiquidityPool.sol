// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title LiquidityPool with Uniswap V2 first-depositor protection
/// @notice Uses a minimal self-contained ERC20 (like Uniswap V2) to allow
///         minting to address(0) for permanent liquidity lock.
contract LiquidityPool {
    // ─── ERC20 state ────────────────────────────────────────────────
    string public constant name = "LP Token";
    string public constant symbol = "LP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ─── Pool state ─────────────────────────────────────────────────
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;

    /// @notice Minimum liquidity permanently locked on first deposit (Uniswap V2 pattern)
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    address public owner;

    // ─── Events ─────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _tokenA, address _tokenB) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        owner = msg.sender;
    }

    // ─── Minimal ERC20 implementation ───────────────────────────────

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "Insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "Insufficient balance");
        unchecked {
            balanceOf[from] -= value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        require(balanceOf[from] >= value, "Insufficient balance");
        unchecked {
            balanceOf[from] -= value;
        }
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    // ─── Pool logic ─────────────────────────────────────────────────

    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 lpTokens) {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalSupply == 0) {
            // First deposit: compute initial LP tokens
            lpTokens = sqrt(amountA * amountB);
            require(lpTokens > MINIMUM_LIQUIDITY, "Insufficient initial liquidity");

            // Lock MINIMUM_LIQUIDITY at address(0) permanently (Uniswap V2 pattern)
            _mint(address(0), MINIMUM_LIQUIDITY);

            // Mint remaining to the first depositor
            _mint(msg.sender, lpTokens - MINIMUM_LIQUIDITY);
        } else {
            // Subsequent deposits: proportional minting using internal reserves
            uint256 lpFromA = amountA * totalSupply / reserveA;
            uint256 lpFromB = amountB * totalSupply / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;

            require(lpTokens > 0, "Insufficient liquidity");
            _mint(msg.sender, lpTokens);
        }

        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    function removeLiquidity(uint256 lpTokens) external returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "Must burn > 0");
        require(balanceOf[msg.sender] >= lpTokens, "Insufficient LP tokens");

        // FIX: Use internal reserves instead of balanceOf to prevent manipulation
        // via direct token transfers
        amountA = lpTokens * reserveA / totalSupply;
        amountB = lpTokens * reserveB / totalSupply;

        require(amountA > 0 && amountB > 0, "Insufficient withdrawal");

        _burn(msg.sender, lpTokens);

        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    /// @notice Sync internal reserves with actual token balances.
    /// Recovers from donation attacks where tokens are sent directly to the pool.
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
