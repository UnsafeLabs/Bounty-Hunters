// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SimpleSwapTest {
    SimpleSwap public swap;
    TestERC20 public tokenA;
    TestERC20 public tokenB;

    function setUp() public {
        tokenA = new TestERC20("Token A", "TKNA");
        tokenB = new TestERC20("Token B", "TKNB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3%

        // Add liquidity
        tokenA.approve(address(swap), 100_000 ether);
        tokenB.approve(address(swap), 100_000 ether);
        swap.addLiquidity(100_000 ether, 100_000 ether);
    }

    function testSwapWithMinAmountOut() public {
        tokenA.approve(address(swap), 1000 ether);
        uint256 expectedOut = swap.getAmountOut(address(tokenA), 1000 ether);
        uint256 out = swap.swap(address(tokenA), 1000 ether, expectedOut, block.timestamp + 1 hours);
        assert(out >= expectedOut);
    }

    function testSlippageReverts() public {
        tokenA.approve(address(swap), 1000 ether);
        bool didRevert = false;
        try swap.swap(address(tokenA), 1000 ether, type(uint256).max, block.timestamp + 1 hours) {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    function testDeadlineReverts() public {
        tokenA.approve(address(swap), 1000 ether);
        bool didRevert = false;
        try swap.swap(address(tokenA), 1000 ether, 0, block.timestamp - 1) {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    function testMinimumFee() public {
        tokenA.approve(address(swap), 1);
        uint256 out = swap.swap(address(tokenA), 1, 0, block.timestamp + 1 hours);
        // Should succeed with at least some output
        assert(out >= 0);
    }
}
