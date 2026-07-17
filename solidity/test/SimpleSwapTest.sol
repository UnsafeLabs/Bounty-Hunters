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

    function testMinFeeNotZero() external view {
        uint256 out = swap.getAmountOut(mockTokenA, 1);
        assert(out > 0);
    }

    function testFeePrecision() external view {
        uint256 small = swap.getAmountOut(mockTokenA, 10);
        uint256 large = swap.getAmountOut(mockTokenA, 100000);
        assert(small > 0);
        assert(large > small);
    }
}
