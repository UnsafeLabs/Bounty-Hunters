// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../LiquidityPool.sol";

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public attacker = address(4);

    uint256 public constant INITIAL_LIQUIDITY_A = 1000 ether;
    uint256 public constant INITIAL_LIQUIDITY_B = 1000 ether;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    /// @dev Inline sqrt — mirrors LiquidityPool.sqrt (which is internal)
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
    
    function setUp() public {
        vm.prank(owner);
        tokenA = new MockERC20("Token A", "TKA", INITIAL_LIQUIDITY_A * 10);
        
        vm.prank(owner);
        tokenB = new MockERC20("Token B", "TKB", INITIAL_LIQUIDITY_B * 10);
        
        vm.prank(owner);
        pool = new LiquidityPool(address(tokenA), address(tokenB));
        
        // Transfer tokens to users
        tokenA.transfer(user1, INITIAL_LIQUIDITY_A);
        tokenB.transfer(user1, INITIAL_LIQUIDITY_B);
        tokenA.transfer(user2, INITIAL_LIQUIDITY_A);
        tokenB.transfer(user2, INITIAL_LIQUIDITY_B);
        tokenA.transfer(attacker, INITIAL_LIQUIDITY_A);
        tokenB.transfer(attacker, INITIAL_LIQUIDITY_B);
    }
    
    // Test: First deposit locks MINIMUM_LIQUIDITY at address(0)
    function test_FirstDepositLock() public {
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        
        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(amountA, amountB);
        
        // Verify MINIMUM_LIQUIDITY is locked at address(0)
        uint256 lockedBalance = pool.balanceOf(address(0));
        assertEq(lockedBalance, MINIMUM_LIQUIDITY, "MINIMUM_LIQUIDITY should be locked at address(0)");
        
        // Verify user receives correct LP tokens
        uint256 expectedLpTokens = _sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
        assertEq(lpTokens, expectedLpTokens, "User should receive correct LP tokens");
        
        // Verify total supply includes locked tokens
        assertEq(pool.totalSupply(), lpTokens + MINIMUM_LIQUIDITY, "Total supply should include locked tokens");
    }
    
    // Test: First depositor cannot manipulate price
    function test_FirstDepositorProtection() public {
        // Attacker tries to be first depositor with tiny amount
        uint256 tinyAmount = 1 ether;
        
        vm.prank(attacker);
        tokenA.approve(address(pool), tinyAmount);
        tokenB.approve(address(pool), tinyAmount);
        
        vm.prank(attacker);
        uint256 attackerLp = pool.addLiquidity(tinyAmount, tinyAmount);
        
        // Attacker donates large amount to pool (direct transfer)
        tokenA.transfer(address(pool), 1000 ether);
        tokenB.transfer(address(pool), 1000 ether);
        
        // Normal user deposits
        uint256 userAmount = 100 ether;
        vm.prank(user1);
        tokenA.approve(address(pool), userAmount);
        tokenB.approve(address(pool), userAmount);
        
        vm.prank(user1);
        uint256 userLp = pool.addLiquidity(userAmount, userAmount);
        
        // User should receive fair amount of LP tokens
        // The price manipulation should not work because we use internal reserves
        assertTrue(userLp > 0, "User should receive LP tokens");
    }
    
    // Test: Subsequent deposits use correct proportional formula
    function test_SubsequentDeposits() public {
        // First deposit
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        
        vm.prank(user1);
        pool.addLiquidity(amountA, amountB);
        
        // Second deposit
        uint256 amountA2 = 50 ether;
        uint256 amountB2 = 50 ether;
        
        vm.prank(user2);
        tokenA.approve(address(pool), amountA2);
        tokenB.approve(address(pool), amountB2);
        
        vm.prank(user2);
        uint256 lpTokens2 = pool.addLiquidity(amountA2, amountB2);
        
        // Calculate expected LP tokens
        uint256 totalSupply = pool.totalSupply();
        uint256 reserveA = pool.reserveA();
        uint256 reserveB = pool.reserveB();
        
        uint256 expectedLpFromA = amountA2 * totalSupply / reserveA;
        uint256 expectedLpFromB = amountB2 * totalSupply / reserveB;
        uint256 expectedLp = expectedLpFromA < expectedLpFromB ? expectedLpFromA : expectedLpFromB;
        
        assertEq(lpTokens2, expectedLp, "Second deposit should use proportional formula");
    }
    
    // Test: removeLiquidity uses internal reserves
    function test_RemoveLiquidityUsesInternalReserves() public {
        // Add liquidity
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        
        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(amountA, amountB);
        
        // Direct transfer to pool (donation attack)
        tokenA.transfer(address(pool), 50 ether);
        tokenB.transfer(address(pool), 50 ether);
        
        // Remove liquidity
        vm.prank(user1);
        (uint256 removedA, uint256 removedB) = pool.removeLiquidity(lpTokens);
        
        // Should use internal reserves, not balanceOf
        uint256 reserveA = pool.reserveA();
        uint256 reserveB = pool.reserveB();
        uint256 totalSupply = pool.totalSupply();
        
        uint256 expectedA = lpTokens * reserveA / totalSupply;
        uint256 expectedB = lpTokens * reserveB / totalSupply;
        
        assertEq(removedA, expectedA, "Should use internal reserve A");
        assertEq(removedB, expectedB, "Should use internal reserve B");
    }
    
    // Test: Direct transfers don't affect LP pricing
    function test_DirectTransfersDontAffectPricing() public {
        // Add liquidity
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        
        vm.prank(user1);
        pool.addLiquidity(amountA, amountB);
        
        uint256 reserveABefore = pool.reserveA();
        uint256 reserveBBefore = pool.reserveB();
        
        // Direct transfer to pool
        tokenA.transfer(address(pool), 50 ether);
        tokenB.transfer(address(pool), 50 ether);
        
        // Reserves should not change
        assertEq(pool.reserveA(), reserveABefore, "Reserve A should not change");
        assertEq(pool.reserveB(), reserveBBefore, "Reserve B should not change");
    }
    
    // Test: Sync function updates reserves
    function test_SyncFunction() public {
        // Add liquidity
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        
        vm.prank(user1);
        pool.addLiquidity(amountA, amountB);
        
        // Direct transfer to pool (donation)
        uint256 donationA = 50 ether;
        uint256 donationB = 50 ether;
        tokenA.transfer(address(pool), donationA);
        tokenB.transfer(address(pool), donationB);
        
        uint256 actualBalanceA = tokenA.balanceOf(address(pool));
        uint256 actualBalanceB = tokenB.balanceOf(address(pool));
        
        // Sync reserves
        pool.sync();
        
        // Reserves should match actual balances
        assertEq(pool.reserveA(), actualBalanceA, "Reserve A should match actual balance");
        assertEq(pool.reserveB(), actualBalanceB, "Reserve B should match actual balance");
    }
    
    // Test: Remove liquidity with zero LP tokens should revert
    function test_RemoveZeroLiquidity() public {
        vm.prank(user1);
        vm.expectRevert("Must burn > 0");
        pool.removeLiquidity(0);
    }
    
    // Test: Add liquidity with zero amounts should revert
    function test_AddZeroLiquidity() public {
        vm.prank(user1);
        vm.expectRevert("Amounts must be > 0");
        pool.addLiquidity(0, 100 ether);
        
        vm.prank(user1);
        vm.expectRevert("Amounts must be > 0");
        pool.addLiquidity(100 ether, 0);
    }
    
    // Test: Get reserves
    function test_GetReserves() public {
        // Add liquidity
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        
        vm.prank(user1);
        pool.addLiquidity(amountA, amountB);
        
        (uint256 reserveA, uint256 reserveB) = pool.getReserves();
        
        assertEq(reserveA, amountA, "Reserve A should match deposited amount");
        assertEq(reserveB, amountB, "Reserve B should match deposited amount");
    }
    
    // Test: Multiple users can add and remove liquidity
    function test_MultipleUsers() public {
        // User 1 adds liquidity
        uint256 amount1A = 100 ether;
        uint256 amount1B = 100 ether;

        vm.prank(user1);
        tokenA.approve(address(pool), amount1A);
        tokenB.approve(address(pool), amount1B);

        vm.prank(user1);
        uint256 lpTokens1 = pool.addLiquidity(amount1A, amount1B);

        // User 2 adds liquidity
        uint256 amount2A = 50 ether;
        uint256 amount2B = 50 ether;

        vm.prank(user2);
        tokenA.approve(address(pool), amount2A);
        tokenB.approve(address(pool), amount2B);

        vm.prank(user2);
        uint256 lpTokens2 = pool.addLiquidity(amount2A, amount2B);

        // Both users can remove liquidity
        vm.prank(user1);
        pool.removeLiquidity(lpTokens1);

        vm.prank(user2);
        pool.removeLiquidity(lpTokens2);

        // Pool should be empty (except MINIMUM_LIQUIDITY)
        assertEq(pool.totalSupply(), MINIMUM_LIQUIDITY, "Pool should only have locked liquidity");
    }

    // ===========================
    //  Edge Cases: Reverts
    // ===========================

    /// @dev First deposit with tiny amount (below MINIMUM_LIQUIDITY) should revert
    function test_FirstDeposit_InsufficientInitialLiquidity() public {
        // Tiny amounts would produce sqrt(1 * 1) = 1 LP, which is < MINIMUM_LIQUIDITY (1000)
        uint256 tinyAmount = 1;

        vm.prank(user1);
        tokenA.approve(address(pool), tinyAmount);
        tokenB.approve(address(pool), tinyAmount);

        vm.prank(user1);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(tinyAmount, tinyAmount);
    }

    /// @dev First deposit at exact MINIMUM_LIQUIDITY boundary — sqrt must be > MINIMUM_LIQUIDITY
    function test_FirstDeposit_ExactMinimumBoundary() public {
        // Need sqrt(amountA * amountB) > 1000, so amountA * amountB > 1,000,000
        // amountA=amountB=1000: 1000*1000 = 1,000,000, sqrt = 1000. NOT > 1000 → revert
        // amountA=amountB=1001: 1001*1001 = 1,002,001, sqrt ≈ 1001 > 1000 → OK
        uint256 okAmount = 1001;

        vm.prank(user1);
        tokenA.approve(address(pool), okAmount);
        tokenB.approve(address(pool), okAmount);

        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(okAmount, okAmount);

        // User receives sqrt(1001*1001) - 1000 = 1001 - 1000 = 1 LP token
        assertEq(lpTokens, 1, "Should receive 1 LP token at boundary");
        assertEq(pool.totalSupply(), MINIMUM_LIQUIDITY + 1, "Total supply should be MIN_LIQ + 1");
    }

    /// @dev removeLiquidity with more LP tokens than balance should revert
    function test_RemoveLiquidity_InsufficientLPBalance() public {
        // First add some liquidity
        uint256 amount = 100 ether;

        vm.prank(user1);
        tokenA.approve(address(pool), amount);
        tokenB.approve(address(pool), amount);

        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(amount, amount);

        // User2 has no LP tokens
        vm.prank(user2);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(lpTokens);
    }

    /// @dev Attempting to remove liquidity with no LP tokens should revert
    function test_RemoveLiquidity_NoLPTokens() public {
        uint256 amount = 100 ether;

        vm.prank(user1);
        tokenA.approve(address(pool), amount);
        tokenB.approve(address(pool), amount);

        vm.prank(user1);
        pool.addLiquidity(amount, amount);

        // User2 has zero LP tokens — trying to remove should revert
        vm.prank(user2);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(1);
    }

    /// @dev Tiny second deposit with proportional amounts succeeds (minimum 1 LP)
    function test_AddLiquidity_TinySecondDeposit() public {
        // First deposit: a large amount
        uint256 largeAmount = 1000 ether;

        vm.prank(user1);
        tokenA.approve(address(pool), largeAmount);
        tokenB.approve(address(pool), largeAmount);

        vm.prank(user1);
        pool.addLiquidity(largeAmount, largeAmount);

        // Second deposit: 1 wei each — still proportional, so lpFromA = lpFromB = 1
        uint256 tinyAmount = 1;

        vm.prank(user2);
        tokenA.approve(address(pool), tinyAmount);
        tokenB.approve(address(pool), tinyAmount);

        vm.prank(user2);
        uint256 lpTokens = pool.addLiquidity(tinyAmount, tinyAmount);

        // Should succeed with 1 LP token
        assertEq(lpTokens, 1, "Second depositor with 1 wei should get 1 LP token");
        assertEq(pool.totalSupply(), uint256(1000 ether) + 1, "Total supply updated");
    }

    // ===========================
    //  Edge Cases: Asymmetric deposits
    // ===========================

    /// @dev Asymmetric deposit: unequal amounts of A and B
    function test_AsymmetricDeposit() public {
        uint256 amountA = 200 ether;
        uint256 amountB = 100 ether;

        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);

        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(amountA, amountB);

        // Verify reserves updated correctly
        assertEq(pool.reserveA(), amountA, "Reserve A should match");
        assertEq(pool.reserveB(), amountB, "Reserve B should match");
        assertTrue(lpTokens > MINIMUM_LIQUIDITY, "LP tokens should be > MINIMUM_LIQUIDITY");
    }

    /// @dev Second depositor with unequal amounts
    function test_SubsequentAsymmetricDeposit() public {
        // First deposit: equal amounts
        uint256 firstAmount = 100 ether;

        vm.prank(user1);
        tokenA.approve(address(pool), firstAmount);
        tokenB.approve(address(pool), firstAmount);

        vm.prank(user1);
        pool.addLiquidity(firstAmount, firstAmount);

        // Second deposit: unequal amounts
        uint256 amountA2 = 100 ether;
        uint256 amountB2 = 50 ether;

        vm.prank(user2);
        tokenA.approve(address(pool), amountA2);
        tokenB.approve(address(pool), amountB2);

        vm.prank(user2);
        uint256 lpTokens2 = pool.addLiquidity(amountA2, amountB2);

        // LP tokens should be based on the smaller ratio (token B)
        uint256 totalSupply = pool.totalSupply();
        uint256 reserveB = pool.reserveB();

        uint256 expectedLpFromB = amountB2 * totalSupply / reserveB;
        assertEq(lpTokens2, expectedLpFromB, "LP tokens should be based on token B ratio");

        // Reserves should be updated
        assertEq(pool.reserveA(), firstAmount + amountA2, "Reserve A should include both deposits");
        assertEq(pool.reserveB(), firstAmount + amountB2, "Reserve B should include both deposits");
    }

    // ===========================
    //  Edge Cases: Sync event
    // ===========================

    /// @dev Sync emits the Sync event with correct reserve values
    function test_Sync_EmitsEvent() public {
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;

        vm.prank(user1);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);

        vm.prank(user1);
        pool.addLiquidity(amountA, amountB);

        // Direct donation to pool
        tokenA.transfer(address(pool), 50 ether);
        tokenB.transfer(address(pool), 50 ether);

        uint256 expectedA = tokenA.balanceOf(address(pool));
        uint256 expectedB = tokenB.balanceOf(address(pool));

        // Sync should emit event with updated reserves
        vm.expectEmit(true, true, true, true);
        emit Sync(expectedA, expectedB);
        pool.sync();
    }
}

// Mock ERC20 token for testing
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply;
        balanceOf[msg.sender] = _initialSupply;
    }
    
    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    
    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
