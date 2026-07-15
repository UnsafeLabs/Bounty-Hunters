// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LiquidityPool {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public tokenA;
    address public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalLpSupply;

    mapping(address => uint256) public lpBalances;
    mapping(address => uint256) public pendingA;
    mapping(address => uint256) public pendingB;

    event Mint(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event Burn(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event Swap(address indexed swapper, address fromToken, uint256 amountIn, uint256 amountOut);
    event Sync(uint256 reserveA, uint256 reserveB);

    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token addresses");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    function addLiquidity(uint256 amountA, uint256 amountB)
        public
        returns (uint256 liquidity)
    {
        uint256 actualA = amountA;
        uint256 actualB = amountB;

        // Update internal reserves BEFORE minting LP tokens
        if (reserveA == 0 && reserveB == 0) {
            // First deposit: lock MINIMUM_LIQUIDITY to prevent price manipulation
            liquidity = sqrt(actualA * actualB) - MINIMUM_LIQUIDITY;
            require(liquidity > 0, "Insufficient initial liquidity");
            // Lock MINIMUM_LIQUIDITY tokens at address(0)
            lpBalances[address(0)] = MINIMUM_LIQUIDITY;
            totalLpSupply = MINIMUM_LIQUIDITY;
        } else {
            uint256 shareA = (actualA * totalLpSupply) / reserveA;
            uint256 shareB = (actualB * totalLpSupply) / reserveB;
            liquidity = shareA < shareB ? shareA : shareB;
        }

        require(liquidity > 0, "Insufficient liquidity minted");

        totalLpSupply += liquidity;
        lpBalances[msg.sender] += liquidity;
        reserveA += actualA;
        reserveB += actualB;

        // Transfer tokens from provider
        IERC20(tokenA).transferFrom(msg.sender, address(this), actualA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), actualB);

        emit Mint(msg.sender, actualA, actualB, liquidity);
    }

    function removeLiquidity(uint256 liquidity)
        public
        returns (uint256 amountA, uint256 amountB)
    {
        require(lpBalances[msg.sender] >= liquidity, "Insufficient LP balance");
        require(liquidity > 0, "Must remove positive liquidity");

        // Use internal reserves, not balanceOf(address(this))
        amountA = (liquidity * reserveA) / totalLpSupply;
        amountB = (liquidity * reserveB) / totalLpSupply;

        totalLpSupply -= liquidity;
        lpBalances[msg.sender] -= liquidity;
        reserveA -= amountA;
        reserveB -= amountB;

        IERC20(tokenA).transfer(msg.sender, amountA);
        IERC20(tokenB).transfer(msg.sender, amountB);

        emit Burn(msg.sender, amountA, amountB, liquidity);
    }

    function swap(address fromToken, uint256 amountIn)
        public
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Zero amount");
        require(fromToken == tokenA || fromToken == tokenB, "Invalid token");

        uint256 reserveIn = fromToken == tokenA ? reserveA : reserveB;
        uint256 reserveOut = fromToken == tokenA ? reserveB : reserveA;

        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut > 0, "Insufficient output");
        require(amountOut < reserveOut, "Insufficient liquidity");

        if (fromToken == tokenA) {
            IERC20(tokenA).transferFrom(msg.sender, address(this), amountIn);
            reserveA += amountIn;
            reserveB -= amountOut;
            IERC20(tokenB).transfer(msg.sender, amountOut);
        } else {
            IERC20(tokenB).transferFrom(msg.sender, address(this), amountIn);
            reserveB += amountIn;
            reserveA -= amountOut;
            IERC20(tokenA).transfer(msg.sender, amountOut);
        }

        emit Swap(msg.sender, fromToken, amountIn, amountOut);
    }

    function sync()
        public
    {
        uint256 actualA = IERC20(tokenA).balanceOf(address(this));
        uint256 actualB = IERC20(tokenB).balanceOf(address(this));
        reserveA = actualA;
        reserveB = actualB;
        emit Sync(reserveA, reserveB);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Insufficient input");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
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

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}
