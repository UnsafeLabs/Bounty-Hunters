// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "Insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "Transfer to zero address");
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract LiquidityPoolTest is Test {
    event Sync(uint256 reserveA, uint256 reserveB);

    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    LiquidityPool internal pool;

    address internal first = address(0x1);
    address internal second = address(0x2);
    address internal attacker = address(0x3);

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        tokenA.mint(first, 1_000_000 ether);
        tokenB.mint(first, 1_000_000 ether);
        tokenA.mint(second, 1_000_000 ether);
        tokenB.mint(second, 1_000_000 ether);
        tokenA.mint(attacker, 1_000_000 ether);
        tokenB.mint(attacker, 1_000_000 ether);
    }

    function testFirstDepositLocksMinimumLiquidity() public {
        _approve(first);

        vm.prank(first);
        uint256 lpTokens = pool.addLiquidity(10_000, 10_000);

        assertEq(pool.MINIMUM_LIQUIDITY(), 1000);
        assertEq(pool.balanceOf(address(0)), 1000);
        assertEq(lpTokens, 9000);
        assertEq(pool.balanceOf(first), 9000);
        assertEq(pool.totalSupply(), 10_000);
        assertEq(pool.reserveA(), 10_000);
        assertEq(pool.reserveB(), 10_000);
    }

    function testFirstDepositorCannotUseTinyInitialDeposit() public {
        _approve(attacker);

        vm.prank(attacker);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(1, 1);
    }

    function testSubsequentDepositsUseInternalReserveRatioAfterDonation() public {
        _addInitialLiquidity(first, 10_000, 10_000);

        vm.prank(attacker);
        tokenA.transfer(address(pool), 90_000);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 90_000);

        _approve(second);
        vm.prank(second);
        uint256 lpTokens = pool.addLiquidity(10_000, 10_000);

        assertEq(lpTokens, 10_000);
        assertEq(pool.balanceOf(second), 10_000);
        assertEq(pool.reserveA(), 20_000);
        assertEq(pool.reserveB(), 20_000);
        assertEq(tokenA.balanceOf(address(pool)), 110_000);
        assertEq(tokenB.balanceOf(address(pool)), 110_000);
    }

    function testRemoveLiquidityUsesInternalReservesNotDonatedBalances() public {
        _addInitialLiquidity(first, 10_000, 10_000);

        vm.prank(attacker);
        tokenA.transfer(address(pool), 90_000);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 90_000);

        uint256 beforeA = tokenA.balanceOf(first);
        uint256 beforeB = tokenB.balanceOf(first);

        vm.prank(first);
        pool.removeLiquidity(9000);

        assertEq(tokenA.balanceOf(first) - beforeA, 9000);
        assertEq(tokenB.balanceOf(first) - beforeB, 9000);
        assertEq(pool.reserveA(), 1000);
        assertEq(pool.reserveB(), 1000);
    }

    function testSyncRecoversInternalReservesAfterDonation() public {
        _addInitialLiquidity(first, 10_000, 10_000);

        vm.prank(attacker);
        tokenA.transfer(address(pool), 5000);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 7000);

        vm.expectEmit(false, false, false, true, address(pool));
        emit Sync(15_000, 17_000);
        pool.sync();

        assertEq(pool.reserveA(), 15_000);
        assertEq(pool.reserveB(), 17_000);
    }

    function _addInitialLiquidity(address provider, uint256 amountA, uint256 amountB) internal {
        _approve(provider);
        vm.prank(provider);
        pool.addLiquidity(amountA, amountB);
    }

    function _approve(address owner) internal {
        vm.startPrank(owner);
        tokenA.approve(address(pool), type(uint256).max);
        tokenB.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }
}
