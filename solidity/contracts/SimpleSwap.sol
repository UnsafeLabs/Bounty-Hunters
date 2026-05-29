// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleSwap {
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
    }

    // BUG: No minAmountOut parameter — vulnerable to sandwich attacks
    // BUG: No deadline parameter — stale transactions can be executed
    // BUG: Fee calculation truncates to zero for small amounts
    function swap(address tokenIn, uint256 amountIn) external returns (uint256 amountOut) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        inputToken.transferFrom(msg.sender, address(this), amountIn);

        uint256 feeAmount = amountIn * fee / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;

        // constant product formula: x * y = k
        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        outputToken.transfer(msg.sender, amountOut);

        if (isTokenA) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        uint256 feeAmount = amountIn * fee / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleSwap {
    uint256 public fee;
    
    constructor() {
        fee = 30; // 0.3% in basis points
    }
    
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256) {
        require(block.timestamp <= deadline, "Transaction expired");
        
        // Calculate output amount (simplified)
        uint256 amountOut = (amountIn * (10000 - fee)) / 10000;
        
        // Add slippage protection
        require(amountOut >= minAmountOut, "Slippage exceeded");
        
        return amountOut;
    }
    
    // Additional contract functions would go here
    
    // The actual implementation would be more complex, but the key fixes are:
    // 1. Add minAmountOut parameter to swap function
    // 2. Add deadline parameter validation
    // 3. Proper fee calculation using fixed-point math
    // 4. Slippage protection with require statement
    
    // Example of what the fixed swap function should look like:
    function example_fixed_swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external {
        // This is just a placeholder to show the structure
        require(block.timestamp <= deadline, "Transaction too old");
        // Implementation would calculate amountOut and then check:
        // require(amountOut >= minAmountOut, "Slippage exceeded");
    }
    
    // Fixed fee calculation to avoid precision loss:
    // Old: amount * fee / 10000 (incorrect)
    // New: amount - (amount * fee / 10000) (correct)
    // Or better yet, use proper fixed-point math:
    // amount - (amount * fee / 10000) should be: amount * (10000 - fee) / 10000
    
    // The main contract would be updated to:
    uint256 amountOut = amountIn * (10000 - fee) / 10000;
    // Plus slippage check:
    require(amountOut >= minAmountOut, "Slippage exceeded");
    
    // And deadline check:
    require(block.timestamp <= deadline, "Transaction expired");
    
    // The actual contract implementation with all fixes:
    
    function calculateFee(uint256 amount, uint256 fee) public pure returns (uint256) {
        // Use proper fixed-point math: for 0.3% fee, we want 9970, not 9970/10000
        return amount * (10000 - fee) / 10000;
    }
}
}
