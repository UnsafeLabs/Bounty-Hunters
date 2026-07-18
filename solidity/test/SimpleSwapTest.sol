// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/SimpleSwap.sol";

contract SimpleSwapTest {
    SimpleSwap public swap;
    address public mockTokenA = address(0x1111);
    address public mockTokenB = address(0x2222);

    constructor() {
        swap = new SimpleSwap(mockTokenA, mockTokenB, 30);
    }

    function testQuoteExactOutput() external view {
        uint256 out = swap.getAmountOut(mockTokenA, 10000);
        assert(out > 0);
    }

    function testFeePrecisionSmallAmount() external view {
        // With fee = 30 (0.3%), original code: 10 * 30 / 10000 = 0
        // Fixed-point math: (reserveOut * 10 * 9970) / (reserveIn * 10000 + 10 * 9970) > 0
        uint256 out = swap.getAmountOut(mockTokenA, 10);
        assert(out > 0);
    }

    function testFeePrecisionUnitAmount() external view {
        // Even with amountIn = 1, fee should not truncate to zero
        uint256 out = swap.getAmountOut(mockTokenA, 1);
        assert(out > 0);
    }

    function testOutputScale() external view {
        uint256 small = swap.getAmountOut(mockTokenA, 10);
        uint256 large = swap.getAmountOut(mockTokenA, 100000);
        assert(large > small);
    }

    function testGetAmountOutSymmetry() external view {
        uint256 outAB = swap.getAmountOut(mockTokenA, 1000);
        uint256 outBA = swap.getAmountOut(mockTokenB, 1000);
        assert(outAB > 0);
        assert(outBA > 0);
    }
}
