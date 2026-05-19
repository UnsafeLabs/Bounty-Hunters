// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 1000000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockToken public staking;
    MockToken public reward;
    address public user = address(0x11);
    address public attacker = address(0x22);

    function setUp() public {
        staking = new MockToken();
        reward = new MockToken();
        vault = new YieldVault(address(staking), address(reward));

        staking.mint(user, 10000 ether);
        reward.mint(address(vault), 10000 ether);

        vm.prank(user);
        staking.approve(address(vault), type(uint256).max);
    }

    function test_RewardAccrualDuringPeriod() public {
        vault.notifyRewardAmount(1000 ether, 100);

        vm.prank(user);
        vault.deposit(100 ether);

        vm.warp(block.timestamp + 50); // half duration

        assertEq(vault.earned(user), 500 ether);
    }

    function test_RewardFreezeAfterPeriod() public {
        vault.notifyRewardAmount(1000 ether, 100);

        vm.prank(user);
        vault.deposit(100 ether);

        vm.warp(block.timestamp + 150); // past duration

        assertEq(vault.earned(user), 1000 ether);

        vm.warp(block.timestamp + 200); // even more past duration

        assertEq(vault.earned(user), 1000 ether); // Still 1000
    }

    function test_UnauthorizedNotify() public {
        vm.prank(attacker);
        vm.expectRevert("Not authorized");
        vault.notifyRewardAmount(1000 ether, 100);
    }

    function test_PrecisionVerification() public {
        // Without precision fix, 10 ether / 3 days loses a lot of wei
        uint256 rewardAmount = 10 ether;
        uint256 duration = 3 days;

        vault.notifyRewardAmount(rewardAmount, duration);

        vm.prank(user);
        vault.deposit(1 ether);

        vm.warp(block.timestamp + duration);
        
        uint256 earned = vault.earned(user);
        
        // Allowed error is < 0.01%
        uint256 expected = rewardAmount;
        uint256 diff = expected > earned ? expected - earned : earned - expected;
        
        assertTrue(diff * 10000 / expected < 1);
    }
}
