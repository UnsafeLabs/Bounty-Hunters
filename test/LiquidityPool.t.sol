// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/LiquidityPool.sol";

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    
    uint256 public constant INITIAL_LIQUIDITY_A = 1000 ether;
    uint256 public constant INITIAL_LIQUIDITY_B = 1000 ether;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    
    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA", INITIAL_LIQUIDITY_A * 10);
        tokenB = new MockERC20("Token B", "TKB", INITIAL_LIQUIDITY_B * 10);
        
        pool = new LiquidityPool(address(tokenA), address(tokenB));
        
        // Transfer tokens to users
        tokenA.transfer(user1, INITIAL_LIQUIDITY_A);
        tokenB.transfer(user1, INITIAL_LIQUIDITY_B);
        tokenA.transfer(user2, INITIAL_LIQUIDITY_A);
        tokenB.transfer(user2, INITIAL_LIQUIDITY_B);
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
        uint256 expectedLpTokens = pool.sqrt(amountA * amountB) - MINIMUM_LIQUIDITY;
        assertEq(lpTokens, expectedLpTokens, "User should receive correct LP tokens");
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
        (uint256 reserveA, uint256 reserveB) = pool.getReserves();
        
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
        (uint256 reserveA, uint256 reserveB) = pool.getReserves();
        uint256 totalSupply = pool.totalSupply();
        
        uint256 expectedA = lpTokens * reserveA / totalSupply;
        uint256 expectedB = lpTokens * reserveB / totalSupply;
        
        assertEq(removedA, expectedA, "Should use internal reserve A");
        assertEq(removedB, expectedB, "Should use internal reserve B");
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
        (uint256 reserveA, uint256 reserveB) = pool.getReserves();
        assertEq(reserveA, actualBalanceA, "Reserve A should match actual balance");
        assertEq(reserveB, actualBalanceB, "Reserve B should match actual balance");
    }
}

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
