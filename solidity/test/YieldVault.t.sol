// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../contracts/YieldVault.sol";

/// @dev Minimal mintable ERC20 used to fund staking and reward flows in tests.
contract MockERC20 is IERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract YieldVaultTest is Test {
    MockERC20 internal staking;
    MockERC20 internal reward;
    YieldVault internal vault;

    address internal distributor = address(this);
    address internal user = address(0xA11CE);
    address internal stranger = address(0xBEEF);

    uint256 internal constant STAKE = 1_000 ether;

    function setUp() public {
        staking = new MockERC20();
        reward = new MockERC20();
        // Deployer becomes the rewardDistributor.
        vault = new YieldVault(address(staking), address(reward));

        staking.mint(user, STAKE);
        vm.prank(user);
        staking.approve(address(vault), STAKE);
        vm.prank(user);
        vault.deposit(STAKE);
    }

    function _notify(uint256 amount, uint256 duration) internal {
        reward.mint(address(vault), amount);
        vault.notifyRewardAmount(amount, duration);
    }

    /// Rewards must accrue while the period is active (no broken accrual).
    function testRewardAccruesDuringPeriod() public {
        uint256 amount = 100 ether;
        uint256 duration = 1_000;
        _notify(amount, duration);

        vm.warp(block.timestamp + duration / 2);

        uint256 earned = vault.earned(user);
        assertGt(earned, 0, "no reward accrued mid-period");
        // ~half the budget, allow rounding slack.
        assertApproxEqRel(earned, amount / 2, 1e12);
    }

    /// Phantom accrual fix: once periodFinish passes, earned must freeze.
    function testRewardFreezesAfterPeriodExpiry() public {
        uint256 amount = 100 ether;
        uint256 duration = 1_000;
        _notify(amount, duration);

        vm.warp(block.timestamp + duration); // exactly at periodFinish
        uint256 earnedAtFinish = vault.earned(user);

        vm.warp(block.timestamp + 10 * duration); // long after expiry
        uint256 earnedLater = vault.earned(user);

        assertEq(earnedLater, earnedAtFinish, "rewards accrued after expiry");
    }

    /// Access control: only the rewardDistributor may fund new periods.
    function testUnauthorizedNotifyReverts() public {
        reward.mint(address(vault), 100 ether);
        vm.prank(stranger);
        vm.expectRevert(bytes("Not authorized"));
        vault.notifyRewardAmount(100 ether, 1_000);
    }

    /// Precision: with the 1e18-scaled rate, distributed rewards stay within
    /// 0.01% of the announced budget even when `reward / duration` truncates.
    function testRewardRatePrecision() public {
        // reward / duration = 3.33333... -> integer division would drop ~10%.
        uint256 amount = 333_333;
        uint256 duration = 100_000;
        _notify(amount, duration);

        vm.warp(block.timestamp + duration);

        vm.prank(user);
        vault.claimReward();

        uint256 paid = reward.balanceOf(user);
        uint256 diff = amount > paid ? amount - paid : paid - amount;
        // |paid - amount| / amount < 0.01%  <=>  diff * 10000 < amount
        assertLt(diff * 10_000, amount, "precision error exceeds 0.01%");
    }
}
