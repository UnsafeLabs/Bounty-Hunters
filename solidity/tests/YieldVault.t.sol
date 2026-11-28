// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {YieldVault} from "../contracts/YieldVault.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract YieldVaultTest is Test {
    YieldVault vault;
    MockToken staking;
    MockToken reward;
    address distributor;

    function setUp() public {
        staking = new MockToken();
        reward = new MockToken();
        vault = new YieldVault(address(staking), address(reward));
        distributor = address(this);
        reward.mint(address(this), 1_000_000e18);
        staking.mint(address(this), 1_000_000e18);
        staking.approve(address(vault), type(uint256).max);
        reward.approve(address(vault), type(uint256).max);
    }

    function test_reward_accrual_during_period() public {
        vault.notifyRewardAmount(100e18, 100 days);
        vault.deposit(100e18);
        vm.warp(block.timestamp + 50 days);
        uint256 e = vault.earned(address(this));
        assertApproxEqRel(e, 50e18, 0.0001e18);
    }

    function test_reward_freeze_after_period() public {
        vault.notifyRewardAmount(100e18, 100 days);
        vault.deposit(100e18);
        vm.warp(block.timestamp + 100 days);
        uint256 finalEarned = vault.earned(address(this));
        vm.warp(block.timestamp + 500 days);
        assertEq(vault.earned(address(this)), finalEarned);
    }

    function test_unauthorized_notify_reverts() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Not authorized distributor");
        vault.notifyRewardAmount(100e18, 10 days);
    }

    function test_authorized_notify_works() public {
        vault.notifyRewardAmount(100e18, 10 days);
        assertEq(vault.periodFinish(), block.timestamp + 10 days);
    }

    function test_precision_rate() public {
        vault.notifyRewardAmount(1e18, 3 days);
        vault.deposit(1e18);
        vm.warp(block.timestamp + 3 days);
        uint256 e = vault.earned(address(this));
        assertApproxEqRel(e, 1e18, 0.0001e18);
    }

    function test_deposit_withdraw_claim_flow() public {
        vault.notifyRewardAmount(100e18, 100 days);
        vault.deposit(50e18);
        vm.warp(block.timestamp + 100 days);
        vault.withdraw(50e18);
        assertEq(staking.balanceOf(address(this)), 1_000_000e18);
        vault.claimReward();
        assertGt(reward.balanceOf(address(this)), 99e18);
    }
}
