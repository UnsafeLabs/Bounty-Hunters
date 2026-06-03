// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/TokenVesting.sol";

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

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    MockERC20 public token;

    address public owner = vm.addr(1);
    address public beneficiary = vm.addr(2);

    uint256 public totalAllocation = 1000 ether;
    uint256 public start = block.timestamp;
    uint256 public cliffDuration = 365 days;
    uint256 public vestingDuration = 365 days * 2;

    function setUp() public {
        token = new MockERC20();
        token.mint(address(vesting), totalAllocation);

        vm.prank(owner);
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            totalAllocation,
            start,
            cliffDuration,
            vestingDuration
        );
    }

    function test_Constructor() public {
        assertEq(address(vesting.token()), address(token));
        assertEq(vesting.beneficiary(), beneficiary);
        assertEq(vesting.totalAllocation(), totalAllocation);
    }

    function test_VestedAmount_BeforeCliff() public {
        assertEq(vesting.vestedAmount(), 0);
    }

    function test_VestedAmount_AtCliff() public {
        vm.warp(start + cliffDuration);
        assertEq(vesting.vestedAmount(), totalAllocation / 2);
    }

    function test_VestedAmount_AfterVesting() public {
        vm.warp(start + vestingDuration);
        assertEq(vesting.vestedAmount(), totalAllocation);
    }

    function test_Claim() public {
        vm.warp(start + cliffDuration);
        vesting.claim();
        assertEq(vesting.claimed(), totalAllocation / 2);
    }

    function test_Claim_BeforeCliff_Reverts() public {
        vm.expectRevert("Before cliff");
        vesting.claim();
    }

    function test_Revoke() public {
        vm.warp(start + cliffDuration);
        vm.prank(owner);
        vesting.revoke();
        assertTrue(vesting.revoked());
    }
}
