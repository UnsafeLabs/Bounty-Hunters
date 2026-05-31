// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/SimpleSwap.sol";

interface Vm {
    function expectRevert(bytes calldata revertData) external;
    function warp(uint256 newTimestamp) external;
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
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
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SimpleSwapTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private tokenA;
    MockERC20 private tokenB;
    SimpleSwap private swapper;

    function setUp() public {
        tokenA = new MockERC20("Token A", "A");
        tokenB = new MockERC20("Token B", "B");
        swapper = new SimpleSwap(address(tokenA), address(tokenB), 30);

        tokenA.mint(address(this), 20_000);
        tokenB.mint(address(this), 20_000);
        tokenA.approve(address(swapper), type(uint256).max);
        tokenB.approve(address(swapper), type(uint256).max);
        swapper.addLiquidity(10_000, 10_000);
    }

    function testSwapSucceedsWithExactExpectedOutput() public {
        uint256 expected = swapper.getAmountOut(address(tokenA), 100);
        uint256 beforeBalance = tokenB.balanceOf(address(this));

        uint256 actual = swapper.swap(address(tokenA), 100, expected, block.timestamp);

        require(actual == expected, "unexpected output");
        require(tokenB.balanceOf(address(this)) == beforeBalance + expected, "missing output");
    }

    function testSwapRevertsWhenOutputFallsBelowMinimum() public {
        uint256 expected = swapper.getAmountOut(address(tokenA), 100);

        vm.expectRevert(bytes("Slippage exceeded"));
        swapper.swap(address(tokenA), 100, expected + 1, block.timestamp);
    }

    function testSwapRevertsAfterDeadline() public {
        vm.warp(100);

        vm.expectRevert(bytes("Deadline expired"));
        swapper.swap(address(tokenA), 100, 0, 99);
    }

    function testFeeUsesFixedPointMathBeforeConstantProductDivision() public {
        uint256 amountIn = 100;
        uint256 oldFeeAmount = amountIn * 30 / 10_000;
        uint256 oldAmountInAfterFee = amountIn - oldFeeAmount;
        uint256 oldRoundedOutput = 10_000 * oldAmountInAfterFee / (10_000 + oldAmountInAfterFee);

        uint256 fixedPointOutput = swapper.getAmountOut(address(tokenA), amountIn);

        require(oldFeeAmount == 0, "old math should truncate fee");
        require(oldRoundedOutput == 99, "old output changed");
        require(fixedPointOutput == 98, "fixed-point output changed");
    }
}
