// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/YieldVault.sol";
import "../contracts/MockERC20.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes memory) external;
}

contract YieldVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private stakingToken;
    MockERC20 private rewardToken;
    YieldVault private vault;

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    function setUp() public {
        stakingToken = new MockERC20("Stake", "STK");
        rewardToken = new MockERC20("Reward", "RWD");
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        stakingToken.mint(ALICE, 1_000 ether);
        stakingToken.mint(BOB, 1_000 ether);
        rewardToken.mint(address(vault), 1_000 ether);

        vm.prank(ALICE);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(BOB);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    function testRewardAccruesDuringPeriod() public {
        vault.notifyRewardAmount(100 ether, 100);

        vm.prank(ALICE);
        vault.deposit(100 ether);

        vm.warp(block.timestamp + 25);

        assertApproxEqAbs(vault.earned(ALICE), 25 ether, 1 wei);
        assertEq(vault.rewardPerToken(), 0.25 ether);
    }

    function testRewardFreezesAfterPeriodFinish() public {
        vault.notifyRewardAmount(100 ether, 100);

        vm.prank(ALICE);
        vault.deposit(100 ether);

        vm.warp(block.timestamp + 100);
        uint256 earnedAtFinish = vault.earned(ALICE);
        uint256 rewardPerTokenAtFinish = vault.rewardPerToken();

        vm.warp(block.timestamp + 500);

        assertEq(vault.earned(ALICE), earnedAtFinish);
        assertEq(vault.rewardPerToken(), rewardPerTokenAtFinish);
    }

    function testNoPhantomRewardsForDepositsAfterExpiry() public {
        vault.notifyRewardAmount(100 ether, 100);

        vm.warp(block.timestamp + 150);
        vm.prank(ALICE);
        vault.deposit(100 ether);

        vm.warp(block.timestamp + 50);

        assertEq(vault.earned(ALICE), 0);
    }

    function testUnauthorizedNotifyRewardAmountReverts() public {
        vm.prank(BOB);
        vm.expectRevert(bytes("Not reward distributor"));
        vault.notifyRewardAmount(100 ether, 100);
    }

    function testPrecisionLossStaysBelowOneBasisPoint() public {
        uint256 reward = 1 ether;
        uint256 duration = 3;
        vault.notifyRewardAmount(reward, duration);

        vm.prank(ALICE);
        vault.deposit(1 ether);

        vm.warp(block.timestamp + duration);

        uint256 paid = vault.earned(ALICE);
        uint256 error = reward > paid ? reward - paid : paid - reward;
        assertLt(error * 10_000, reward);
    }

    function testWithdrawAndClaimStillWork() public {
        vault.notifyRewardAmount(100 ether, 100);

        vm.prank(ALICE);
        vault.deposit(100 ether);
        vm.warp(block.timestamp + 10);
        vm.prank(ALICE);
        vault.withdraw(40 ether);
        vm.prank(ALICE);
        vault.claimReward();

        assertEq(vault.balanceOf(ALICE), 60 ether);
        assertGt(rewardToken.balanceOf(ALICE), 0);
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "assert eq failed");
    }

    function assertGt(uint256 actual, uint256 minimum) internal pure {
        require(actual > minimum, "assert gt failed");
    }

    function assertLt(uint256 actual, uint256 maximum) internal pure {
        require(actual < maximum, "assert lt failed");
    }

    function assertApproxEqAbs(uint256 actual, uint256 expected, uint256 maxDelta) internal pure {
        uint256 delta = actual > expected ? actual - expected : expected - actual;
        require(delta <= maxDelta, "assert approx failed");
    }
}
