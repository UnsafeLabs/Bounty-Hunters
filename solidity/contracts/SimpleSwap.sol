// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleSwap {
    address public owner;
    bool private locked;

    mapping(address => uint256) public tokenBalances;

    event Swap(address indexed user, address fromToken, address toToken, uint256 amountIn, uint256 amountOut);
    event Deposited(address indexed token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        owner = msg.sender;
    }

    function deposit(address token, uint256 amount) public {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        tokenBalances[token] += amount;
        emit Deposited(token, amount);
    }

    function swap(
        address fromToken,
        address toToken,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    )
        public
        nonReentrant
    {
        require(amountIn > 0, "Amount must be > 0");
        require(deadline >= block.timestamp, "Transaction expired");
        require(tokenBalances[toToken] > 0, "Insufficient liquidity");

        uint256 balanceIn = tokenBalances[fromToken];
        uint256 balanceOut = tokenBalances[toToken];

        uint256 amountOut = getAmountOut(amountIn, balanceIn, balanceOut);
        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut <= tokenBalances[toToken], "Insufficient output balance");

        IERC20(fromToken).transferFrom(msg.sender, address(this), amountIn);
        tokenBalances[fromToken] += amountIn;
        tokenBalances[toToken] -= amountOut;
        IERC20(toToken).transfer(msg.sender, amountOut);

        emit Swap(msg.sender, fromToken, toToken, amountIn, amountOut);
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
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
