// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/LiquidityPool.sol";

interface Vm {
    function prank(address) external;
    function expectRevert(bytes memory) external;
}

contract TestERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        require(balanceOf[from] >= amount, "insufficient balance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract LiquidityPoolTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TestERC20 private tokenA;
    TestERC20 private tokenB;
    LiquidityPool private pool;

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant ATTACKER = address(0xBAD);

    function setUp() public {
        tokenA = new TestERC20("Token A", "TKA");
        tokenB = new TestERC20("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        _fundAndApprove(ALICE, 1_000_000 ether);
        _fundAndApprove(BOB, 1_000_000 ether);
        _fundAndApprove(ATTACKER, 1_000_000 ether);
    }

    function testFirstDepositLocksMinimumLiquidity() public {
        vm.prank(ALICE);
        uint256 minted = pool.addLiquidity(10_000, 10_000);

        assertEq(pool.MINIMUM_LIQUIDITY(), 1000);
        assertEq(pool.balanceOf(address(0)), 1000);
        assertEq(minted, 9_000);
        assertEq(pool.balanceOf(ALICE), 9_000);
        assertEq(pool.totalSupply(), 10_000);
        assertEq(pool.reserveA(), 10_000);
        assertEq(pool.reserveB(), 10_000);
    }

    function testFirstDepositBelowMinimumReverts() public {
        vm.prank(ALICE);
        vm.expectRevert(bytes("Insufficient liquidity"));
        pool.addLiquidity(100, 100);
    }

    function testSubsequentDepositsUseInternalReserveRatio() public {
        vm.prank(ALICE);
        pool.addLiquidity(10_000, 10_000);

        tokenA.transfer(address(pool), 90_000);
        tokenB.transfer(address(pool), 90_000);

        vm.prank(BOB);
        uint256 minted = pool.addLiquidity(1_000, 1_000);

        assertEq(minted, 1_000);
        assertEq(pool.balanceOf(BOB), 1_000);
        assertEq(pool.reserveA(), 11_000);
        assertEq(pool.reserveB(), 11_000);
    }

    function testDonationDoesNotIncreaseWithdrawalAmount() public {
        vm.prank(ALICE);
        pool.addLiquidity(10_000, 10_000);

        tokenA.transfer(address(pool), 90_000);
        tokenB.transfer(address(pool), 90_000);

        uint256 aliceBeforeA = tokenA.balanceOf(ALICE);
        uint256 aliceBeforeB = tokenB.balanceOf(ALICE);
        vm.prank(ALICE);
        pool.removeLiquidity(pool.balanceOf(ALICE));

        assertEq(tokenA.balanceOf(ALICE) - aliceBeforeA, 9_000);
        assertEq(tokenB.balanceOf(ALICE) - aliceBeforeB, 9_000);
        assertEq(pool.reserveA(), 1_000);
        assertEq(pool.reserveB(), 1_000);
    }

    function testSyncRecoversDonatedBalances() public {
        vm.prank(ALICE);
        pool.addLiquidity(10_000, 10_000);

        tokenA.transfer(address(pool), 5_000);
        tokenB.transfer(address(pool), 7_000);
        pool.sync();

        assertEq(pool.reserveA(), tokenA.balanceOf(address(pool)));
        assertEq(pool.reserveB(), tokenB.balanceOf(address(pool)));
        assertEq(pool.reserveA(), 15_000);
        assertEq(pool.reserveB(), 17_000);
    }

    function testFirstDepositorPriceManipulationAttemptFails() public {
        vm.prank(ATTACKER);
        vm.expectRevert(bytes("Insufficient liquidity"));
        pool.addLiquidity(1, 1);
    }

    function _fundAndApprove(address account, uint256 amount) internal {
        tokenA.mint(account, amount);
        tokenB.mint(account, amount);
        vm.prank(account);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(account);
        tokenB.approve(address(pool), type(uint256).max);
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assert eq failed");
    }
}
