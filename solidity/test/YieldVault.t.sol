// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../../lib/openzeppelin-contracts/lib/forge-std/src/Test.sol";
import "../contracts/YieldVault.sol";
import "../../../lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MintableToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract YieldVaultTest is Test {
    MintableToken public stakingToken;
    MintableToken public rewardToken;
    YieldVault public vault;

    address public owner = address(0x01);
    address public user = address(0x02);
    address public stranger = address(0x03);

    uint256 constant REWARD_AMOUNT = 1000 ether;
    uint256 constant STAKE_AMOUNT = 100 ether;
    uint256 constant DURATION = 7 days;

    function setUp() public {
        stakingToken = new MintableToken("Staking Token", "STK");
        rewardToken = new MintableToken("Reward Token", "RWD");

        vault = new YieldVault(address(stakingToken), address(rewardToken));

        // Mint tokens to actors
        stakingToken.mint(user, 1000 ether);
        stakingToken.mint(owner, 1000 ether);
        rewardToken.mint(owner, 10000 ether);

        // Approve vault
        vm.startPrank(user);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(owner);
        rewardToken.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // ==================== Reward Accrual During Period ====================

    function test_rewardAccrualDuringPeriod() public {
        vm.prank(owner);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.prank(user);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + DURATION / 2);

        uint256 earned = vault.earned(user);
        emit log_named_uint("earned at midpoint", earned);

        assertGt(earned, 0, "Should have accrued rewards");
        assertLt(earned, REWARD_AMOUNT, "Should not exceed total reward");
    }

    function test_rewardAccrualPartialPeriod() public {
        vm.prank(owner);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.prank(user);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + DURATION / 4);

        uint256 earned = vault.earned(user);
        emit log_named_uint("earned at quarter", earned);

        assertGt(earned, 0, "Should have some rewards at quarter");
        assertLt(earned, REWARD_AMOUNT / 2, "Should be less than half at quarter point");
    }

    // ==================== Reward Freeze After Period Expiry ====================

    function test_rewardsFreezeAfterPeriodExpiry() public {
        vm.prank(owner);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.prank(user);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 earnedAtEnd = vault.earned(user);
        emit log_named_uint("earned at period end", earnedAtEnd);

        vm.warp(block.timestamp + 30 days);

        uint256 earnedAfterExpiry = vault.earned(user);
        emit log_named_uint("earned after period expiry", earnedAfterExpiry);

        assertEq(earnedAtEnd, earnedAfterExpiry, "Rewards should be frozen after period ends");
    }

    function test_newDepositAfterPeriodExpiryNoPhantomRewards() public {
        vm.prank(owner);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.warp(block.timestamp + DURATION + 100);

        // New user deposits after period expiry
        stakingToken.mint(stranger, STAKE_AMOUNT);
        vm.prank(stranger);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(stranger);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + 100 days);

        uint256 newUserEarned = vault.earned(stranger);
        emit log_named_uint("new user earned after expiry", newUserEarned);

        assertEq(newUserEarned, 0, "New deposit after expiry should not accrue phantom rewards");
    }

    function test_rewardPerTokenStoredFreezes() public {
        vm.prank(owner);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.prank(user);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(user);
        vault.claimReward();

        uint256 storedAfterFirstPeriod = vault.rewardPerTokenStored();

        vm.warp(block.timestamp + 365 days);

        uint256 rpt = vault.rewardPerToken();

        assertEq(storedAfterFirstPeriod, rpt, "rewardPerToken should be frozen at period end value");
    }

    // ==================== Unauthorized Rejection ====================

    function test_unauthorizedNotifyRewardAmount() public {
        vm.prank(stranger);
        vm.expectRevert("Not authorized");
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
    }

    function test_rewardDistributorIsDeployer() public {
        assertEq(vault.rewardDistributor(), owner);
    }

    function test_ownerCanNotifyReward() public {
        vm.prank(owner);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        assertGt(vault.rewardRate(), 0, "Reward rate should be set");
        assertGt(vault.periodFinish(), block.timestamp, "Period finish should be in future");
    }

    // ==================== Precision Verification ====================

    function test_precisionLossMinimal() public {
        uint256 smallReward = 1 ether;
        uint256 longDuration = 365 days;

        vm.prank(owner);
        rewardToken.transfer(address(vault), smallReward);
        vm.prank(owner);
        vault.notifyRewardAmount(smallReward, longDuration);

        vm.prank(user);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + longDuration);

        uint256 earned = vault.earned(user);
        emit log_named_uint("earned", earned);
        emit log_named_uint("rewardRate", vault.rewardRate());

        assertGt(earned, 0, "Should earn rewards with improved precision");
    }

    function test_precisionWithSmallRewardRate() public {
        uint256 reward = 100 ether;
        uint256 duration = 1 hours;

        vm.prank(owner);
        rewardToken.transfer(address(vault), reward);
        vm.prank(owner);
        vault.notifyRewardAmount(reward, duration);

        vm.prank(user);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + duration);

        uint256 earned = vault.earned(user);
        emit log_named_uint("earned small reward", earned);

        assertGt(earned, 0, "Should earn something");
        assertLt(earned, reward * 101 / 100, "Should not exceed reward by more than 1%");
    }

    // ==================== Integration ====================

    function test_fullLifecycle() public {
        vm.prank(owner);
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);

        vm.prank(user);
        vault.deposit(STAKE_AMOUNT);

        vm.warp(block.timestamp + DURATION / 2);
        uint256 midEarned = vault.earned(user);
        assertGt(midEarned, 0, "Should have rewards at midpoint");

        vm.warp(block.timestamp + DURATION + 1);
        uint256 endEarned = vault.earned(user);
        assertGe(endEarned, midEarned, "Should have more or equal at end");

        vm.warp(block.timestamp + 100 days);
        uint256 delayedEarned = vault.earned(user);
        assertEq(endEarned, delayedEarned, "No phantom rewards");

        uint256 balanceBefore = rewardToken.balanceOf(user);
        vm.prank(user);
        vault.claimReward();
        uint256 balanceAfter = rewardToken.balanceOf(user);
        assertGt(balanceAfter, balanceBefore, "User should receive reward tokens");
    }
}
