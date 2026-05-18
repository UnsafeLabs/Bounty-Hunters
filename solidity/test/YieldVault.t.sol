// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "lib/forge-std/src/Test.sol";
import "lib/forge-std/src/console.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockToken public stakingToken;
    MockToken public rewardToken;

    address public user1 = address(0x1);
    address public user2 = address(0x2);

    function setUp() public {
        stakingToken = new MockToken("Stake", "STK");
        rewardToken = new MockToken("Reward", "RWD");
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        stakingToken.mint(user1, 10000 ether);
        stakingToken.mint(user2, 10000 ether);
        rewardToken.mint(address(vault), 100000 ether);

        vm.prank(user1);
        stakingToken.approve(address(vault), 10000 ether);
        vm.prank(user2);
        stakingToken.approve(address(vault), 10000 ether);
    }

    function test_RewardAccrualDuringPeriod() public {
        vm.prank(user1);
        vault.deposit(1000 ether);

        vault.notifyRewardAmount(1000 ether, 100);
        vm.warp(block.timestamp + 50);

        uint256 earned = vault.earned(user1);
        assertGt(earned, 490 ether);
        assertLt(earned, 510 ether);
    }

    function test_NoPhantomRewardsAfterPeriodEnd() public {
        vm.prank(user1);
        vault.deposit(1000 ether);

        vault.notifyRewardAmount(1000 ether, 100);
        vm.warp(block.timestamp + 200);

        uint256 earnedAfterPeriod = vault.earned(user1);
        vm.warp(block.timestamp + 500);
        uint256 earnedLater = vault.earned(user1);

        assertEq(earnedAfterPeriod, earnedLater, "Phantom rewards accrued after period end");
    }

    function test_EarnedZeroGrowthAfterPeriod() public {
        vm.prank(user1);
        vault.deposit(1000 ether);

        vault.notifyRewardAmount(100 ether, 10);
        vm.warp(block.timestamp + 10);

        uint256 earned1 = vault.earned(user1);
        vm.warp(block.timestamp + 1000);
        uint256 earned2 = vault.earned(user1);

        assertEq(earned1, earned2, "Earned should not grow after period expiry");
    }

    function test_UnauthorizedNotifyRewardAmount() public {
        vm.prank(user1);
        vm.expectRevert("Not authorized");
        vault.notifyRewardAmount(100 ether, 10);
    }

    function test_AuthorizedDistributorCanNotify() public {
        vault.notifyRewardAmount(100 ether, 10);
        assertGt(vault.rewardRate(), 0);
    }

    function test_PrecisionLossMinimal() public {
        vm.prank(user1);
        vault.deposit(1000 ether);

        vault.notifyRewardAmount(10000 ether, 1000);
        vm.warp(block.timestamp + 1000);

        uint256 earned = vault.earned(user1);
        assertGt(earned, 9990 ether);
    }

    function test_DepositWithdrawClaim() public {
        vm.prank(user1);
        vault.deposit(100 ether);
        assertEq(vault.balanceOf(user1), 100 ether);

        vm.prank(user1);
        vault.withdraw(50 ether);
        assertEq(vault.balanceOf(user1), 50 ether);
    }

    function test_ClaimReward() public {
        vm.prank(user1);
        vault.deposit(1000 ether);

        vault.notifyRewardAmount(100 ether, 100);
        vm.warp(block.timestamp + 100);

        uint256 balanceBefore = rewardToken.balanceOf(user1);
        vm.prank(user1);
        vault.claimReward();
        uint256 balanceAfter = rewardToken.balanceOf(user1);

        assertGt(balanceAfter, balanceBefore);
    }

    function test_MultipleUsersProportionalRewards() public {
        vm.prank(user1);
        vault.deposit(1000 ether);
        vm.prank(user2);
        vault.deposit(3000 ether);

        vault.notifyRewardAmount(400 ether, 100);
        vm.warp(block.timestamp + 100);

        uint256 earned1 = vault.earned(user1);
        uint256 earned2 = vault.earned(user2);

        assertGt(earned2, earned1 * 2);
        assertLt(earned2, earned1 * 4);
    }
}
