// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/YieldVault.sol";

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

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;

    address public owner = vm.addr(1);
    address public user = vm.addr(2);
    address public nonOwner = vm.addr(3);

    function setUp() public {
        stakingToken = new MockERC20();
        rewardToken = new MockERC20();

        vm.prank(owner);
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        stakingToken.mint(user, 1000 ether);
        rewardToken.mint(owner, 1000 ether);

        vm.prank(user);
        stakingToken.approve(address(vault), 1000 ether);

        vm.prank(owner);
        rewardToken.approve(address(vault), 1000 ether);
    }

    function test_Constructor() public {
        assertEq(address(vault.stakingToken()), address(stakingToken));
        assertEq(address(vault.rewardToken()), address(rewardToken));
        assertEq(vault.owner(), owner);
    }

    function test_Constructor_InvalidToken_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid staking token");
        new YieldVault(address(0), address(rewardToken));
    }

    function test_Deposit() public {
        vm.prank(user);
        vault.deposit(100 ether);

        assertEq(vault.balanceOf(user), 100 ether);
        assertEq(vault.totalSupply(), 100 ether);
    }

    function test_Deposit_ZeroAmount_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Cannot deposit 0");
        vault.deposit(0);
    }

    function test_Withdraw() public {
        vm.prank(user);
        vault.deposit(100 ether);

        vm.prank(user);
        vault.withdraw(50 ether);

        assertEq(vault.balanceOf(user), 50 ether);
        assertEq(vault.totalSupply(), 50 ether);
    }

    function test_Withdraw_ZeroAmount_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Cannot withdraw 0");
        vault.withdraw(0);
    }

    function test_Withdraw_InsufficientBalance_Reverts() public {
        vm.prank(user);
        vault.deposit(100 ether);

        vm.prank(user);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(200 ether);
    }

    function test_ClaimReward() public {
        vm.prank(user);
        vault.deposit(100 ether);

        vm.prank(owner);
        vault.notifyRewardAmount(100 ether, 1 days);

        vm.warp(block.timestamp + 1 days);

        vm.prank(user);
        vault.claimReward();

        assertGt(rewardToken.balanceOf(user), 0);
    }

    function test_ClaimReward_NoRewards() public {
        vm.prank(user);
        vault.deposit(100 ether);

        vm.prank(user);
        vault.claimReward();

        assertEq(rewardToken.balanceOf(user), 0);
    }

    function test_NotifyRewardAmount() public {
        vm.prank(owner);
        vault.notifyRewardAmount(100 ether, 1 days);

        assertGt(vault.rewardRate(), 0);
        assertEq(vault.periodFinish(), block.timestamp + 1 days);
    }

    function test_NotifyRewardAmount_NonOwner_Reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Ownable: caller is not the owner");
        vault.notifyRewardAmount(100 ether, 1 days);
    }

    function test_NotifyRewardAmount_ZeroDuration_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Duration must be > 0");
        vault.notifyRewardAmount(100 ether, 0);
    }

    function test_NotifyRewardAmount_ZeroReward_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Reward must be > 0");
        vault.notifyRewardAmount(0, 1 days);
    }

    function test_PhantomRewards_Capped() public {
        vm.prank(user);
        vault.deposit(100 ether);

        vm.prank(owner);
        vault.notifyRewardAmount(100 ether, 1 days);

        // Warp past period finish
        vm.warp(block.timestamp + 2 days);

        // Check that rewardPerToken is capped
        uint256 rpt = vault.rewardPerToken();
        assertGt(rpt, 0);

        // Earned should not increase after period finish
        vm.prank(user);
        vault.claimReward();

        uint256 balance1 = rewardToken.balanceOf(user);

        // Wait more time
        vm.warp(block.timestamp + 1 days);

        // Earned should be same (capped)
        uint256 earned = vault.earned(user);
        assertEq(earned, 0);
    }
}
