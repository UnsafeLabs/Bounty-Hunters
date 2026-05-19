// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public user1 = address(0x11);
    address public attacker = address(0x22);

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        tokenA.mint(user1, 10000 ether);
        tokenB.mint(user1, 10000 ether);
        tokenA.mint(attacker, 10000 ether);
        tokenB.mint(attacker, 10000 ether);

        vm.startPrank(user1);
        tokenA.approve(address(pool), type(uint256).max);
        tokenB.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(attacker);
        tokenA.approve(address(pool), type(uint256).max);
        tokenB.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_FirstDepositLock() public {
        vm.startPrank(user1);
        uint256 lpMinted = pool.addLiquidity(10000, 10000);
        
        assertEq(pool.balanceOf(address(0xdead)), 1000);
        assertEq(lpMinted, 10000 - 1000);
        vm.stopPrank();
    }

    function test_DonationAttackResistance() public {
        vm.startPrank(user1);
        pool.addLiquidity(10000, 10000);
        vm.stopPrank();

        // Attacker donates directly to the pool
        vm.startPrank(attacker);
        tokenA.transfer(address(pool), 5000);
        tokenB.transfer(address(pool), 5000);
        vm.stopPrank();

        // Without sync, the internal reserves shouldn't be affected
        assertEq(pool.reserveA(), 10000);
        assertEq(pool.reserveB(), 10000);

        // User1 removes liquidity
        vm.startPrank(user1);
        uint256 lpBal = pool.balanceOf(user1);
        (uint256 a, uint256 b) = pool.removeLiquidity(lpBal);
        
        // User1 should only get back their share based on internal reserves (which ignores donation)
        // lpBal / totalSupply * reserve = (10000-1000) / 10000 * 10000 = 9000
        assertEq(a, 9000);
        assertEq(b, 9000);
        vm.stopPrank();
    }

    function test_SyncRecovery() public {
        vm.startPrank(user1);
        pool.addLiquidity(10000, 10000);
        vm.stopPrank();

        vm.startPrank(attacker);
        tokenA.transfer(address(pool), 10000); // Pool now has 20000
        tokenB.transfer(address(pool), 10000);
        vm.stopPrank();

        pool.sync(); // Update reserves
        
        assertEq(pool.reserveA(), 20000);
        assertEq(pool.reserveB(), 20000);

        vm.startPrank(user1);
        uint256 lpBal = pool.balanceOf(user1);
        (uint256 a, uint256 b) = pool.removeLiquidity(lpBal);
        
        // User gets portion of 20000: 9000 / 10000 * 20000 = 18000
        assertEq(a, 18000);
        assertEq(b, 18000);
        vm.stopPrank();
    }
}
