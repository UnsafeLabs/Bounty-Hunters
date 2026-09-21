// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title LiquidityPool
 * @dev A minimal Uniswap‑V2‑style liquidity pool that mints LP tokens.
 *      The contract follows the Uniswap V2 pattern to lock a minimum
 *      amount of liquidity on the first deposit, preventing price
 *      manipulation attacks.
 */
contract LiquidityPool is ERC20 {
    // Tokens that make up the pair
    IERC20 public immutable token0;
    IERC20 public immutable token1;

    // Minimum liquidity that is permanently locked
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    // Reserves are stored as uint112 to match Uniswap V2 implementation
    uint112 private reserve0; // token0 reserve
    uint112 private reserve1; // token1 reserve

    // Events
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Sync(uint112 reserve0, uint112 reserve1);

    /**
     * @dev Constructor sets the two ERC20 tokens that form the pool.
     * @param _token0 address of the first token
     * @param _token1 address of the second token
     */
    constructor(address _token0, address _token1) ERC20("Liquidity Pool Token", "LPT") {
        require(_token0 != _token1, "Identical token addresses");
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
    }

    // ------------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------------

    /**
     * @dev Updates the stored reserves to match the actual token balances.
     * Emits a {Sync} event.
     */
    function _update(uint256 balance0, uint256 balance1) internal {
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        emit Sync(reserve0, reserve1);
    }

    /**
     * @dev Returns the current reserves.
     */
    function getReserves() external view returns (uint112 _reserve0, uint112 _reserve1) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }

    // ------------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------------

    /**
     * @dev Adds liquidity to the pool.
     * @param amount0 Desired amount of token0 to deposit.
     * @param amount1 Desired amount of token1 to deposit.
     * @return liquidity Amount of LP tokens minted to the caller.
     *
     * The function pulls the tokens from `msg.sender`. The caller must have
     * approved the pool to transfer the specified amounts.
     */
    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity) {
        require(amount0 > 0 && amount1 > 0, "Amounts must be > 0");

        // Transfer tokens from the sender
        token0.transferFrom(msg.sender, address(this), amount0);
        token1.transferFrom(msg.sender, address(this), amount1);

        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            // First liquidity provision – lock MINIMUM_LIQUIDITY forever
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY); // lock
            _mint(msg.sender, liquidity);
        } else {
            // Subsequent deposits – mint proportionally
            uint256 liquidity0 = (amount0 * _totalSupply) / reserve0;
            uint256 liquidity1 = (amount1 * _totalSupply) / reserve1;
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
            require(liquidity > 0, "Insufficient liquidity minted");
            _mint(msg.sender, liquidity);
        }

        emit Mint(msg.sender, amount0, amount1);

        // Update reserves to the new balances
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
    }

    /**
     * @dev Removes liquidity from the pool.
     * @param liquidity Amount of LP tokens to burn.
     * @return amount0 Amount of token0 returned to the caller.
     * @return amount1 Amount of token1 returned to the caller.
     *
     * The function burns the caller's LP tokens and transfers the proportional
     * share of the underlying assets.
     */
    function removeLiquidity(uint256 liquidity) external returns (uint256 amount0, uint256 amount1) {
        require(liquidity > 0, "Liquidity must be > 0");
        uint256 _totalSupply = totalSupply();

        // Use internal reserves for calculation – they cannot be manipulated
        amount0 = (liquidity * reserve0) / _totalSupply;
        amount1 = (liquidity * reserve1) / _totalSupply;

        require(amount0 > 0 && amount1 > 0, "Insufficient amount withdrawn");

        // Burn LP tokens
        _burn(msg.sender, liquidity);
        emit Burn(msg.sender, amount0, amount1, msg.sender);

        // Transfer underlying tokens
        token0.transfer(msg.sender, amount0);
        token1.transfer(msg.sender, amount1);

        // Update reserves after the transfer
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
    }

    /**
     * @dev Syncs the internal reserves with the actual token balances.
     *
     * This function can be called by anyone and is useful after a direct
     * token transfer (donation) to the pool that would otherwise corrupt the
     * price calculation.
     */
    function sync() external {
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
    }

    // ------------------------------------------------------------------------
    // Math helpers
    // ------------------------------------------------------------------------

    /**
     * @dev Returns the integer square root of a number. Reverts on overflow.
     */
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
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
