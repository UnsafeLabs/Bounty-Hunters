solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Mock ERC20 token for testing
/// @notice Provides flexible minting to any address for test setups
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 100_000_000e18);
    }

    /// @notice Mint tokens to any address
    /// @param to Recipient address
    /// @param amount Amount to mint (in wei)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title SimpleSwapTest
/// @notice Comprehensive test suite for SimpleSwap contract with slippage and deadline protection
/// @dev Covers all specified acceptance criteria including success paths, slippage reverts,
///      deadline reverts, input validation, edge cases, fee precision, reverse swaps,
///      and multiple successive swaps.
contract SimpleSwapTest is Test {
    // -----------------------------------------------------------------------
    //  Constants
    // -----------------------------------------------------------------------
    uint256 private constant INITIAL_BALANCE_USER = 10_000_000e18;
    uint256 private constant INITIAL_LIQUIDITY_A = 1_000_000e18;
    uint256 private constant INITIAL_LIQUIDITY_B = 1_000_000e18;
    uint256 private constant FEE_BASIS_POINTS = 30; // 0.3%
    uint256 private constant FEE_DENOMINATOR = 10_000;
    uint256 private constant FEE_SCALE = 1e18; // scaling factor for precise fee calculation
    uint256 private constant ONE_WEI = 1;

    // -----------------------------------------------------------------------
    //  State variables
    // -----------------------------------------------------------------------
    SimpleSwap public swapContract;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public constant USER = address(0x123);
    address public constant LIQUIDITY_PROVIDER = address(0x456);
    address public constant USER2 = address(0x789);

    // -----------------------------------------------------------------------
    //  Events expected from the system (for event-emission tests)
    // -----------------------------------------------------------------------
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 deadline
    );

    // -----------------------------------------------------------------------
    //  Setup
    // -----------------------------------------------------------------------

    /// @notice Deploy tokens, swap contract, add initial liquidity, fund users
    function setUp() public {
        // Deploy tokens
        tokenA = new MockERC20("TokenA", "TKA");
        tokenB = new MockERC20("TokenB", "TKB");

        // Deploy swap contract with fee
        swapContract = new SimpleSwap(address(tokenA), address(tokenB), FEE_BASIS_POINTS);

        // Mint tokens to liquidity provider for adding liquidity
        tokenA.mint(LIQUIDITY_PROVIDER, INITIAL_LIQUIDITY_A * 100);
        tokenB.mint(LIQUIDITY_PROVIDER, INITIAL_LIQUIDITY_B * 100);

        // Add liquidity
        vm.startPrank(LIQUIDITY_PROVIDER);
        tokenA.approve(address(swapContract), INITIAL_LIQUIDITY_A);
        tokenB.approve(address(swapContract), INITIAL_LIQUIDITY_B);
        swapContract.addLiquidity(INITIAL_LIQUIDITY_A, INITIAL_LIQUIDITY_B);
        vm.stopPrank();

        // Fund user and approve
        tokenA.mint(USER, INITIAL_BALANCE_USER);
        vm.prank(USER);
        tokenA.approve(address(swapContract), type(uint256).max);

        // Fund second user for reverse swaps and multi-swap tests
        tokenB.mint(USER2, INITIAL_BALANCE_USER);
        vm.prank(USER2);
        tokenB.approve(address(swapContract), type(uint256).max);
    }

    // =======================================================================
    //  HELPERS
    // =======================================================================

    /// @notice Compute expected output after fee for a 1:1 pool using scaled arithmetic
    /// @dev Replicates the contract's precise fee calculation (accumulator-based)
    /// @param amountIn Amount to swap (in wei)
    /// @param feeAccumulator Current fee accumulator from pool (can be retrieved via getter)
    /// @return amountOut Expected output after fee (rounded down, with overflow from accumulator)
    /// @return newAccumulator Updated accumulator after this swap
    function _computeExpectedOutputPrecise(
        uint256 amountIn,
        uint256 feeAccumulator
    ) private pure returns (uint256 amountOut, uint256 newAccumulator) {
        // Simulate precise fee: (amountIn * feeBasisPoints) / FEE_DENOMINATOR  + fractional overflow
        uint256 feeNumerator = amountIn * FEE_BASIS_POINTS;
        uint256 integerFee = feeNumerator / FEE_DENOMINATOR;
        uint256 remainder = feeNumerator % FEE_DENOMINATOR;

        // Add remainder to accumulator; if it exceeds denominator, take an extra wei fee
        uint256 acc = feeAccumulator + remainder;
        uint256 extraFee = acc >= FEE_DENOMINATOR ? 1 : 0;
        if (extraFee > 0) {
            acc -= FEE_DENOMINATOR;
        }

        uint256 totalFee = integerFee + extraFee;
        amountOut = amountIn > totalFee ? amountIn - totalFee : 0;
        newAccumulator = acc;
    }

    /// @notice Assert pool balances are consistent after swap
    /// @param tokenIn Address of input token
    /// @param tokenOut Address of output token
    /// @param amountIn Amount sent in
    /// @param amountOut Amount received out
    /// @param initialUserTokenA User's initial tokenA balance (before swap)
    /// @param initialUserTokenB User's initial tokenB balance
    /// @param initialPoolA Pool's initial tokenA reserve
    /// @param initialPoolB Pool's initial tokenB reserve
    function _assertBalances(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 initialUserTokenA,
        uint256 initialUserTokenB,
        uint256 initialPoolA,
        uint256 initialPoolB
    ) private view {
        uint256 expectedUserA = initialUserTokenA - (tokenIn == address(tokenA) ? amountIn : 0);
        uint256 expectedUserB = initialUserTokenB + (tokenOut == address(tokenB) ? amountOut : 0);
        assertEq(tokenA.balanceOf(USER), expectedUserA, "User tokenA balance");
        assertEq(tokenB.balanceOf(USER), expectedUserB, "User tokenB balance");

        uint256 expectedPoolA = initialPoolA + (tokenIn == address(tokenA) ? amountIn : 0);
        uint256 expectedPoolB = initialPoolB - (tokenOut == address(tokenB) ? amountOut : 0);
        assertEq(tokenA.balanceOf(address(swapContract)), expectedPoolA, "Pool tokenA reserve");
        assertEq(tokenB.balanceOf(address(swapContract)), expectedPoolB, "Pool tokenB reserve");
    }

    /// @notice Overloaded helper using default initial balances
    function _assertBalances(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) private view {
        _assertBalances(
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            INITIAL_BALANCE_USER,  // user initial tokenA
            0,                      // user initial tokenB
            INITIAL_LIQUIDITY_A,
            INITIAL_LIQUIDITY_B
        );
    }

    // =======================================================================
    //  TEST: SUCCESS SWAP
    // =======================================================================

    /// @notice Test successful swap with exact minAmountOut and valid deadline
    function test_SuccessfulSwap() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 expectedOut;
        uint256 dummyAcc;
        (expectedOut, dummyAcc) = _computeExpectedOutputPrecise(amountIn, 0); // accumulator initially 0

        // Use exact expected output as minAmountOut
        vm.prank(USER);
        uint256 amountOut = swapContract.swap(
            address(tokenA),
            address(tokenB),
            amountIn,
            expectedOut,
            deadline
        );

        // Verify output with tolerance (accumulator may have changed due to previous swaps? Here only one swap)
        assertGe(amountOut, expectedOut, "Output should be at least expected");
        _assertBalances(address(tokenA), address(tokenB), amountIn, amountOut);
    }

    /// @notice Test successful swap with a slightly lower minAmountOut (allowing slippage)
    function test_SuccessfulSwapWithLowerMin() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 expectedOut;
        uint256 dummyAcc;
        (expectedOut, dummyAcc) = _computeExpectedOutputPrecise(amountIn, 0);

        // minAmountOut = 90% of expected (should still succeed)
        uint256 minOut = (expectedOut * 90) / 100;
        vm.prank(USER);
        uint256 amountOut = swapContract.swap(
            address(tokenA),
            address(tokenB),
            amountIn,
            minOut,
            deadline
        );
        assertGe(amountOut, minOut, "Output should be >= minOut");
    }

    // =======================================================================
    //  TEST: SLIPPAGE REVERT
    // =======================================================================

    /// @notice Test that swap reverts when minAmountOut is greater than actual output
    function test_RevertWhenSlippageExceeded() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 expectedOut;
        uint256 dummyAcc;
        (expectedOut, dummyAcc) = _computeExpectedOutputPrecise(amountIn, 0);

        // Set minAmountOut higher than expected output
        uint256 highMin = expectedOut + 1;
        vm.prank(USER);
        vm.expectRevert("Slippage exceeded");
        swapContract.swap(address(tokenA), address(tokenB), amountIn, highMin, deadline);
    }

    /// @notice Test that swap reverts with zero minAmountOut but actual output is zero (edge case)
    function test_RevertWhenSlippageExceededZeroOutput() public {
        // For very small amountIn, fee may consume the entire amount, resulting in zero output
        uint256 amountIn = 1; // 1 wei, fee 0.3% = 0.003 wei -> 0 wei after integer rounding
        uint256 deadline = block.timestamp + 1 hours;
        // Expected output = 0
        uint256 minOut = 1; // unrealistic, but should revert because output is 0
        vm.prank(USER);
        vm.expectRevert("Slippage exceeded");
        swapContract.swap(address(tokenA), address(tokenB), amountIn, minOut, deadline);
    }

    // =======================================================================
    //  TEST: DEADLINE REVERT
    // =======================================================================

    /// @notice Test that swap reverts when deadline has passed
    function test_RevertWhenDeadlineExpired() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp; // current block timestamp, swap executes during this block, but should be allowed if timestamp >= deadline? Typically allows execution if block.timestamp <= deadline. This test sets deadline to current time, swap may still pass if the block timestamp is exactly equal. For robustness, set deadline to past.
        vm.warp(block.timestamp + 1); // warp forward so block.timestamp > deadline
        vm.prank(USER);
        vm.expectRevert("Deadline expired");
        swapContract.swap(address(tokenA), address(tokenB), amountIn, 0, deadline);
    }

    /// @notice Test that swap reverts when deadline is in the past (strictly less than current timestamp)
    function test_RevertWhenDeadlineStrictlyPast() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp - 1; // one second ago
        vm.prank(USER);
        vm.expectRevert("Deadline expired");
        swapContract.swap(address(tokenA), address(tokenB), amountIn, 0, deadline);
    }

    // =======================================================================
    //  TEST: INPUT VALIDATION
    // =======================================================================

    /// @notice Test that swap reverts with zero amountIn
    function test_RevertWhenAmountInZero() public {
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(USER);
        vm.expectRevert("Amount must be positive");
        swapContract.swap(address(tokenA), address(tokenB), 0, 0, deadline);
    }

    /// @notice Test that swap reverts when tokenIn and tokenOut are the same
    function test_RevertWhenTokenInEqualsTokenOut() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(USER);
        vm.expectRevert("Cannot swap same token");
        swapContract.swap(address(tokenA), address(tokenA), amountIn, 0, deadline);
    }

    /// @notice Test that swap reverts when token addresses are invalid
    function test_RevertWhenInvalidToken() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(USER);
        vm.expectRevert("Invalid token address");
        swapContract.swap(address(0), address(tokenB), amountIn, 0, deadline);
    }

    // =======================================================================
    //  TEST: REVERSE SWAP (B -> A)
    // =======================================================================

    /// @notice Test successful reverse swap
    function test_ReverseSwapTokenBtoA() public {
        uint256 amountIn = 500e18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 expectedOut;
        uint256 dummyAcc;
        (expectedOut, dummyAcc) = _computeExpectedOutputPrecise(amountIn, 0);

        vm.prank(USER2);
        uint256 amountOut = swapContract.swap(
            address(tokenB),
            address(tokenA),
            amountIn,
            expectedOut,
            deadline
        );

        assertGe(amountOut, expectedOut, "Output should be at least expected");

        // Verify balances from USER2 perspective
        uint256 userBAfter = tokenB.balanceOf(USER2);
        uint256 userABefore = 0; // USER2 had no tokenA initially
        assertEq(userBAfter, INITIAL_BALANCE_USER - amountIn, "USER2 tokenB balance");
        assertEq(tokenA.balanceOf(USER2), userABefore + amountOut, "USER2 tokenA balance");
    }

    // =======================================================================
    //  TEST: SUCCESSIVE SWAPS
    // =======================================================================

    /// @notice Test multiple swaps and verify accumulator behavior
    function test_SuccessiveSwaps() public {
        uint256 amountIn1 = 100e18;
        uint256 amountIn2 = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        // First swap
        uint256 expectedOut1;
        uint256 acc1;
        (expectedOut1, acc1) = _computeExpectedOutputPrecise(amountIn1, 0);
        vm.prank(USER);
        uint256 out1 = swapContract.swap(
            address(tokenA),
            address(tokenB),
            amountIn1,
            expectedOut1,
            deadline
        );
        assertGe(out1, expectedOut1, "Output1 should meet minimum");

        // Second swap - use updated accumulator (from contract state, but we cannot query easily; use expected with accumulator from first simulator)
        uint256 expectedOut2;
        uint256 acc2;
        (expectedOut2, acc2) = _computeExpectedOutputPrecise(amountIn2, acc1);
        vm.prank(USER);
        uint256 out2 = swapContract.swap(
            address(tokenA),
            address(tokenB),
            amountIn2,
            expectedOut2,
            deadline
        );
        assertGe(out2, expectedOut2, "Output2 should meet minimum");
    }

    // =======================================================================
    //  TEST: FEE COLLECTION AND PRECISION
    // =======================================================================

    /// @notice Test that fee is collected correctly and that the contract does not lose precision over many small swaps
    function test_FeePrecisionManySmallSwaps() public {
        // Perform many small swaps (e.g., 1 wei each) and ensure total output is close to total input minus fee
        uint256 totalAmountIn;
        uint256 totalAmountOut;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 iterations = 1000;
        uint256 smallAmount = 100; // 100 wei per swap

        for (uint256 i = 0; i < iterations; i++) {
            uint256 expectedOut;
            uint256 dummyAcc;
            (expectedOut, dummyAcc) = _computeExpectedOutputPrecise(smallAmount, 0); // simplified, ignore accumulator cross-swap for this test
            vm.prank(USER);
            uint256 out = swapContract.swap(
                address(tokenA),
                address(tokenB),
                smallAmount,
                0, // zero min to allow any output
                deadline
            );
            totalAmountIn += smallAmount;
            totalAmountOut += out;
        }
        // The total fee should be totalAmountIn * FEE_BASIS_POINTS / FEE_DENOMINATOR, but with possible rounding.
        uint256 expectedFee = (totalAmountIn * FEE_BASIS_POINTS) / FEE_DENOMINATOR;
        uint256 exactOutput = totalAmountIn - expectedFee;
        // Due to accumulator, actual output may be one wei less or more, within tolerance
        assertApproxEqAbs(totalAmountOut, exactOutput, 1, "Total output should approximate input minus fee");
    }

    // =======================================================================
    //  TEST: SWAP WITH ZERO MINOUTPUT (should work but not encouraged)
    // =======================================================================

    /// @notice Test that swap succeeds when minAmountOut is zero (allowing worst-case)
    function test_SwapWithZeroMinOut() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(USER);
        uint256 out = swapContract.swap(
            address(tokenA),
            address(tokenB),
            amountIn,
            0,
            deadline
        );
        assertGt(out, 0, "Output should be positive");
    }

    // =======================================================================
    //  TEST: REVERT ON INSUFFICIENT BALANCE
    // =======================================================================

    /// @notice Test revert when user does not have enough tokens
    function test_RevertWhenInsufficientBalance() public {
        uint256 amountIn = INITIAL_BALANCE_USER + 1;
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(USER);
        vm.expectRevert("ERC20: transfer amount exceeds balance");
        swapContract.swap(address(tokenA), address(tokenB), amountIn, 0, deadline);
    }

    // =======================================================================
    //  TEST: REVERT ON INSUFFICIENT ALLOWANCE
    // =======================================================================

    /// @notice Test revert when user has not approved enough tokens
    function test_RevertWhenInsufficientAllowance() public {
        // Revoke approval for user
        vm.prank(USER);
        tokenA.approve(address(swapContract), 0);
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(USER);
        vm.expectRevert("ERC20: insufficient allowance");
        swapContract.swap(address(tokenA), address(tokenB), amountIn, 0, deadline);
    }

    // =======================================================================
    //  TEST: EVENT EMISSION
    // =======================================================================

    /// @notice Test that Swap event is emitted with correct parameters
    function test_SwapEventEmitted() public {
        uint256 amountIn = 1000e18;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 expectedOut;
        uint256 dummyAcc;
        (expectedOut, dummyAcc) = _computeExpectedOutputPrecise(amountIn, 0);
        vm.prank(USER);
        vm.expectEmit(true, true, true, true);
        emit Swap(USER, address(tokenA), address(tokenB), amountIn, expectedOut, deadline);
        swapContract.swap(address(tokenA), address(tokenB), amountIn, expectedOut, deadline);
    }

    // =======================================================================
    //  EDGE CASES
    // =======================================================================

    /// @notice Swap with 1 wei amountIn (precision edge case)
    function test_SwapOneWei() public {
        uint256 amountIn = 1;
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(USER);
        uint256 out = swapContract.swap(
            address(tokenA),
            address(tokenB),
            amountIn,
            0,
            deadline
        );
        // Expected: fee = 1*30/10000 = 0, so out = 1 wei
        assertEq(out, 1, "Output for 1 wei should be 1 wei (fee rounds to 0)");
    }

    /// @notice Swap with large amount close to pool reserves
    function test_SwapLargeAmount() public {
        uint256 amountIn = INITIAL_LIQUIDITY_A / 2;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 expectedOut;
        uint256 dummyAcc;
        (expectedOut, dummyAcc) = _computeExpectedOutputPrecise(amountIn, 0);
        vm.prank(USER);
        uint256 out = swapContract.swap(
            address(tokenA),
            address(tokenB),
            amountIn,
            expectedOut,
            deadline
        );
        assertGe(out, expectedOut, "Output should meet minimum");
    }
}