// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/CrossChainBridge.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockERC20 public token;

    address public validator = vm.addr(1);
    address public user = vm.addr(2);

    function setUp() public {
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);

        token.mint(user, 10000 ether);
        vm.prank(user);
        token.approve(address(bridge), 10000 ether);
    }

    function test_InitiateTransfer() public {
        vm.prank(user);
        bridge.initiateTransfer(100 ether, 137);

        assertEq(token.balanceOf(address(bridge)), 100 ether);
        assertEq(bridge.getNonce(user), 1);
    }

    function test_InitiateTransfer_ZeroAmount_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        bridge.initiateTransfer(0, 137);
    }

    function test_GetPoolBalance() public {
        assertEq(bridge.getPoolBalance(), 0);

        vm.prank(user);
        bridge.initiateTransfer(100 ether, 137);

        assertEq(bridge.getPoolBalance(), 100 ether);
    }
}
