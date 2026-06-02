// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/SimpleSwap.sol";

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    
    uint256 public constant INITIAL_LIQUIDITY = 1000 ether;
    uint256 public constant SWAP_AMOUNT = 100 ether;
    uint256 public constant FEE = 30; // 0.3%
    
    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA", INITIAL_LIQUIDITY * 10);
        tokenB = new MockERC20("Token B", "TKB", INITIAL_LIQUIDITY * 10);
        
        vm.prank(owner);
        swap = new SimpleSwap(address(tokenA), address(tokenB), FEE);
        
        // Transfer tokens to users
        tokenA.transfer(user1, INITIAL_LIQUIDITY);
        tokenB.transfer(user1, INITIAL_LIQUIDITY);
        tokenA.transfer(user2, INITIAL_LIQUIDITY);
        tokenB.transfer(user2, INITIAL_LIQUIDITY);
    }
    
    // Test: Add liquidity
    function test_AddLiquidity() public {
        uint256 amountA = 100 ether;
        uint256 amountB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(swap), amountA);
        tokenB.approve(address(swap), amountB);
        
        vm.prank(user1);
        swap.addLiquidity(amountA, amountB);
        
        (uint256 reserveA, uint256 reserveB) = swap.getReserves();
        assertEq(reserveA, amountA, "Reserve A should match");
        assertEq(reserveB, amountB, "Reserve B should match");
    }
    
    // Test: Swap with slippage protection
    function test_SwapWithSlippageProtection() public {
        // Add liquidity first
        uint256 liquidityA = 1000 ether;
        uint256 liquidityB = 1000 ether;
        
        vm.prank(user1);
        tokenA.approve(address(swap), liquidityA);
        tokenB.approve(address(swap), liquidityB);
        
        vm.prank(user1);
        swap.addLiquidity(liquidityA, liquidityB);
        
        // Calculate expected output
        uint256 expectedOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);
        
        // Swap with minAmountOut
        vm.prank(user2);
        tokenA.approve(address(swap), SWAP_AMOUNT);
        
        vm.prank(user2);
        swap.swap(address(tokenA), SWAP_AMOUNT, expectedOut, block.timestamp + 1);
        
        // Verify user received tokens
        assertTrue(tokenB.balanceOf(user2) > 0, "User should receive tokens");
    }
    
    // Test: Swap with deadline
    function test_SwapWithDeadline() public {
        // Add liquidity first
        uint256 liquidityA = 1000 ether;
        uint256 liquidityB = 1000 ether;
        
        vm.prank(user1);
        tokenA.approve(address(swap), liquidityA);
        tokenB.approve(address(swap), liquidityB);
        
        vm.prank(user1);
        swap.addLiquidity(liquidityA, liquidityB);
        
        // Try to swap with expired deadline
        vm.prank(user2);
        tokenA.approve(address(swap), SWAP_AMOUNT);
        
        vm.prank(user2);
        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), SWAP_AMOUNT, 0, block.timestamp - 1);
    }
    
    // Test: Zero amount swap should revert
    function test_ZeroAmountSwap() public {
        vm.prank(user2);
        vm.expectRevert("Amount must be > 0");
        swap.swap(address(tokenA), 0, 0, block.timestamp + 1);
    }
    
    // Test: Invalid token swap should revert
    function test_InvalidTokenSwap() public {
        vm.prank(user2);
        vm.expectRevert("Invalid token");
        swap.swap(address(this), SWAP_AMOUNT, 0, block.timestamp + 1);
    }
    
    // Test: Get amount out
    function test_GetAmountOut() public {
        // Add liquidity
        uint256 liquidityA = 1000 ether;
        uint256 liquidityB = 1000 ether;
        
        vm.prank(user1);
        tokenA.approve(address(swap), liquidityA);
        tokenB.approve(address(swap), liquidityB);
        
        vm.prank(user1);
        swap.addLiquidity(liquidityA, liquidityB);
        
        uint256 amountOut = swap.getAmountOut(address(tokenA), SWAP_AMOUNT);
        assertTrue(amountOut > 0, "Amount out should be positive");
    }
    
    // Test: Sync function
    function test_SyncFunction() public {
        // Add liquidity
        uint256 liquidityA = 100 ether;
        uint256 liquidityB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(swap), liquidityA);
        tokenB.approve(address(swap), liquidityB);
        
        vm.prank(user1);
        swap.addLiquidity(liquidityA, liquidityB);
        
        // Direct transfer to pool
        tokenA.transfer(address(swap), 50 ether);
        tokenB.transfer(address(swap), 50 ether);
        
        // Sync
        vm.prank(owner);
        swap.sync();
        
        // Reserves should match actual balances
        (uint256 reserveA, uint256 reserveB) = swap.getReserves();
        assertEq(reserveA, tokenA.balanceOf(address(swap)), "Reserve A should match balance");
        assertEq(reserveB, tokenB.balanceOf(address(swap)), "Reserve B should match balance");
    }
    
    // Test: Skim function
    function test_SkimFunction() public {
        // Add liquidity
        uint256 liquidityA = 100 ether;
        uint256 liquidityB = 100 ether;
        
        vm.prank(user1);
        tokenA.approve(address(swap), liquidityA);
        tokenB.approve(address(swap), liquidityB);
        
        vm.prank(user1);
        swap.addLiquidity(liquidityA, liquidityB);
        
        // Direct transfer to pool
        tokenA.transfer(address(swap), 50 ether);
        tokenB.transfer(address(swap), 50 ether);
        
        uint256 ownerBalanceA = tokenA.balanceOf(owner);
        uint256 ownerBalanceB = tokenB.balanceOf(owner);
        
        // Skim
        vm.prank(owner);
        swap.skim();
        
        // Owner should receive excess tokens
        assertEq(tokenA.balanceOf(owner), ownerBalanceA + 50 ether, "Owner should receive excess A");
        assertEq(tokenB.balanceOf(owner), ownerBalanceB + 50 ether, "Owner should receive excess B");
    }
    
    // Test: Access control
    function test_AccessControl() public {
        // Non-owner cannot sync
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        swap.sync();
        
        // Non-owner cannot skim
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        swap.skim();
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
