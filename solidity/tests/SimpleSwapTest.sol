// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/SimpleSwap.sol";
import "../mocks/MockERC20.sol";

/// @title SimpleSwapTest - Foundry tests for SimpleSwap slippage and deadline fix (issue #913)
/// @notice Run with: forge test --match-contract SimpleSwapTest -vvv
contract SimpleSwapTest {
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    SimpleSwap public swap;

    address public user = address(this);
    address public attacker = address(0xBAD);
    address public other = address(0xCAFE);

    uint256 constant INITIAL_LIQUIDITY_A = 1000 * 1e18;
    uint256 constant INITIAL_LIQUIDITY_B = 1000 * 1e18;
    uint256 constant SWAP_AMOUNT = 100 * 1e18;
    uint256 constant FEE_BPS = 30; // 0.3%

    function setUp() public {
        tokenA = new MockERC20("TokenA", "TKA", 18);
        tokenB = new MockERC20("TokenB", "TKB", 18);
        swap = new SimpleSwap(address(tokenA), address(tokenB), FEE_BPS);

        // Fund the swap contract with liquidity
        tokenA.mint(address(swap), INITIAL_LIQUIDITY_A);
        tokenB.mint(address(swap), INITIAL_LIQUIDITY_B);
        swap.addLiquidity(INITIAL_LIQUIDITY_A, INITIAL_LIQUIDITY_B);

        // Fund user with tokens
        tokenA.mint(user, 10000 * 1e18);
        tokenB.mint(user, 10000 * 1e18);

        // Approve swap contract
        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);
    }

    // =========================================
    // Test: Successful swap with exact expected output
    // Issue #913 acceptance criteria
    // =========================================
    function test_swap_exactExpectedOutput_succeeds() public {
        uint256 expectedOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);

        uint256 balBefore = tokenB.balanceOf(user);
        swap.swap(address(tokenA), SWAP_AMOUNT, expectedOut, block.timestamp + 1 hours);
        uint256 balAfter = tokenB.balanceOf(user);

        assert(balAfter - balBefore == expectedOut, "Should receive exact expected output");
    }

    // =========================================
    // Test: Swap with output below minAmountOut reverts
    // Issue #913 acceptance criteria
    // =========================================
    function test_swap_slippageExceeded_reverts() public {
        uint256 expectedOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);

        // Try to swap with minAmountOut higher than actual output
        uint256 tooHighMinOut = expectedOut + 1;

        bool reverted = false;
        try swap.swap(address(tokenA), SWAP_AMOUNT, tooHighMinOut, block.timestamp + 1 hours) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Should revert when slippage exceeded");
    }

    // =========================================
    // Test: Expired transactions revert with deadline error
    // Issue #913 acceptance criteria
    // =========================================
    function test_swap_expiredDeadline_reverts() public {
        // Set deadline in the past
        uint256 pastDeadline = block.timestamp - 1;

        bool reverted = false;
        try swap.swap(address(tokenA), SWAP_AMOUNT, 0, pastDeadline) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Should revert when transaction expired");
    }

    // =========================================
    // Test: Swap at exact deadline succeeds
    // =========================================
    function test_swap_atExactDeadline_succeeds() public {
        uint256 deadline = block.timestamp;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);

        uint256 balBefore = tokenB.balanceOf(user);
        swap.swap(address(tokenA), SWAP_AMOUNT, expectedOut, deadline);
        uint256 balAfter = tokenB.balanceOf(user);

        assert(balAfter - balBefore == expectedOut, "Should succeed at exact deadline");
    }

    // =========================================
    // Test: Swap with minAmountOut = 0 (no slippage protection)
    // =========================================
    function test_swap_zeroMinAmountOut_succeeds() public {
        uint256 balBefore = tokenB.balanceOf(user);
        swap.swap(address(tokenA), SWAP_AMOUNT, 0, block.timestamp + 1 hours);
        uint256 balAfter = tokenB.balanceOf(user);

        assert(balAfter > balBefore, "Should receive tokens");
    }

    // =========================================
    // Test: Sandwich attack protection
    // Simulate attacker front-running and verify slippage protection works
    // =========================================
    function test_swap_sandwichAttack_prevented() public {
        uint256 expectedOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);

        // User submits swap with minAmountOut protection
        // Attacker tries to front-run by swapping first (which would reduce output)
        // Let's simulate: attacker swaps before user
        tokenA.mint(attacker, SWAP_AMOUNT);
        vm.prank(attacker);
        tokenA.approve(address(swap), SWAP_AMOUNT);
        vm.prank(attacker);
        swap.swap(address(tokenA), SWAP_AMOUNT, 0, block.timestamp + 1 hours);

        // Now user's expected output is less due to attacker's swap
        uint256 newExpectedOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);
        assert(newExpectedOut < expectedOut, "Output should decrease after attacker swap");

        // User's original minAmountOut should now be higher than actual output
        // This would cause the swap to revert, protecting the user
        bool reverted = false;
        try swap.swap(address(tokenA), SWAP_AMOUNT, expectedOut, block.timestamp + 1 hours) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Sandwich attack should be prevented by slippage protection");
    }

    // =========================================
    // Test: Fee calculation precision for small amounts
    // Issue #913 - fee calculation fix
    // =========================================
    function test_swap_smallAmount_feePrecision() public {
        // Small amount that would lose precision with old calculation
        uint256 smallAmount = 100; // 100 wei

        // With fee = 30 bps: old calculation 100 * 30 / 10000 = 0 (truncated)
        // New calculation should use mulDiv for precision

        // We can verify by checking getAmountOut
        uint256 amountOut = swap.getAmountOut(address(tokenA), smallAmount);
        // For very small amounts with liquidity, output should still be > 0
        // (though it may be very small)
        
        // Test with a slightly larger small amount
        uint256 smallAmount2 = 1e15; // 0.001 tokens
        uint256 expectedOut = swap.getAmountOut(address(tokenA), smallAmount2);

        // Approve and swap
        tokenA.approve(address(swap), smallAmount2);
        uint256 balBefore = tokenB.balanceOf(user);
        swap.swap(address(tokenA), smallAmount2, 0, block.timestamp + 1 hours);
        uint256 balAfter = tokenB.balanceOf(user);

        assert(balAfter - balBefore == expectedOut, "Should match getAmountOut for small amounts");
    }

    // =========================================
    // Test: Swap in both directions
    // =========================================
    function test_swap_tokenB_to_tokenA_succeeds() public {
        uint256 expectedOut = swap.getAmountOut(address(tokenB), SWAP_AMOUNT);

        uint256 balBefore = tokenA.balanceOf(user);
        swap.swap(address(tokenB), SWAP_AMOUNT, expectedOut, block.timestamp + 1 hours);
        uint256 balAfter = tokenA.balanceOf(user);

        assert(balAfter - balBefore == expectedOut, "Should swap tokenB to tokenA correctly");
    }

    // =========================================
    // Test: Invalid token input
    // =========================================
    function test_swap_invalidToken_reverts() public {
        MockERC20 tokenC = new MockERC20("TokenC", "TKC", 18);

        bool reverted = false;
        try swap.swap(address(tokenC), SWAP_AMOUNT, 0, block.timestamp + 1 hours) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Should revert for invalid token");
    }

    // =========================================
    // Test: Zero amount input
    // =========================================
    function test_swap_zeroAmount_reverts() public {
        bool reverted = false;
        try swap.swap(address(tokenA), 0, 0, block.timestamp + 1 hours) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Should revert for zero amount");
    }

    // =========================================
    // Test: Multiple swaps maintain reserves correctly
    // =========================================
    function test_swap_multipleSwaps_reservesCorrect() public {
        uint256 swapAmount1 = 100 * 1e18;
        uint256 swapAmount2 = 50 * 1e18;

        // First swap: A -> B
        uint256 expectedOut1 = swap.getAmountOut(address(tokenA), swapAmount1);
        swap.swap(address(tokenA), swapAmount1, expectedOut1, block.timestamp + 1 hours);

        // Second swap: B -> A
        uint256 expectedOut2 = swap.getAmountOut(address(tokenB), swapAmount2);
        swap.swap(address(tokenB), swapAmount2, expectedOut2, block.timestamp + 1 hours);

        // Verify reserves changed correctly
        // After first swap: reserveA increases, reserveB decreases
        // After second swap: reserveB increases, reserveA decreases
        // Net effect: reserves should be non-zero
        assert(swap.reserveA() > 0, "ReserveA should be > 0");
        assert(swap.reserveB() > 0, "ReserveB should be > 0");
    }

    // =========================================
    // Test: Deadline just 1 second in the past
    // =========================================
    function test_swap_deadlineOneSecondPast_reverts() public {
        uint256 deadline = block.timestamp - 1;

        bool reverted = false;
        try swap.swap(address(tokenA), SWAP_AMOUNT, 0, deadline) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Should revert for deadline 1 second in past");
    }

    // =========================================
    // Test: Deadline far in the future succeeds
    // =========================================
    function test_swap_farFutureDeadline_succeeds() public {
        uint256 deadline = block.timestamp + 365 days;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);

        uint256 balBefore = tokenB.balanceOf(user);
        swap.swap(address(tokenA), SWAP_AMOUNT, expectedOut, deadline);
        uint256 balAfter = tokenB.balanceOf(user);

        assert(balAfter - balBefore == expectedOut, "Should succeed with far future deadline");
    }

    // =========================================
    // Test: Large amount slippage protection
    // =========================================
    function test_swap_largeAmount_slippageProtection() public {
        uint256 largeAmount = 500 * 1e18; // 50% of reserves
        uint256 expectedOut = swap.getAmountOut(address(tokenA), largeAmount);

        // Calculate what the output would be after someone else swaps first
        uint256 smallSwap = 10 * 1e18;
        tokenA.mint(attacker, smallSwap);
        vm.prank(attacker);
        tokenA.approve(address(swap), smallSwap);
        vm.prank(attacker);
        swap.swap(address(tokenA), smallSwap, 0, block.timestamp + 1 hours);

        uint256 newExpectedOut = swap.getAmountOut(address(tokenA), largeAmount);
        assert(newExpectedOut < expectedOut, "Output should decrease");

        // Should revert with original expected as minAmountOut
        bool reverted = false;
        try swap.swap(address(tokenA), largeAmount, expectedOut, block.timestamp + 1 hours) {
        } catch {
            reverted = true;
        }
        assert(reverted, "Should revert when slippage exceeded for large amount");
    }

    // =========================================
    // Test: getAmountOut matches actual output
    // =========================================
    function test_getAmountOut_matchesActualOutput() public {
        // Test multiple amounts
        uint256[] memory amounts = new uint256[](5);
        amounts[0] = 1 * 1e18;
        amounts[1] = 10 * 1e18;
        amounts[2] = 100 * 1e18;
        amounts[3] = 250 * 1e18;
        amounts[4] = 500 * 1e18;

        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 expected = swap.getAmountOut(address(tokenA), amounts[i]);
            tokenA.approve(address(swap), amounts[i]);
            uint256 balBefore = tokenB.balanceOf(user);
            swap.swap(address(tokenA), amounts[i], 0, block.timestamp + 1 hours);
            uint256 balAfter = tokenB.balanceOf(user);
            assert(balAfter - balBefore == expected, "getAmountOut should match actual output");
        }
    }

    // Foundry cheatcodes interface
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
}
