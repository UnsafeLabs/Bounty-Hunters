// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Malicious contract that attempts reentrancy on withdraw
contract MaliciousWithdrawer {
    StakingVault public vault;
    uint256 public attackCount;

    constructor(address payable _vault) {
        vault = StakingVault(_vault);
    }

    function attack() external {
        attackCount = 0;
        uint256 balance = vault.balances(address(this));
        require(balance > 0, "No balance to withdraw");
        vault.withdraw(balance);
    }

    receive() external payable {
        // Try to re-enter withdraw
        attackCount++;
        uint256 balance = vault.balances(address(this));
        if (balance > 0) {
            try vault.withdraw(balance) {} catch {}
        }
    }
}

// Malicious contract that attempts reentrancy on claimRewards
contract MaliciousRewardClaimer {
    StakingVault public vault;
    uint256 public attackCount;

    constructor(address payable _vault) {
        vault = StakingVault(_vault);
    }

    function attack() external {
        attackCount = 0;
        vault.claimRewards();
    }

    receive() external payable {
        // Try to re-enter claimRewards
        attackCount++;
        uint256 pending = vault.getPendingRewards(address(this));
        if (pending > 0) {
            try vault.claimRewards() {} catch {}
        }
    }
}

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockERC20 public token;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 constant REWARD_RATE = 1e16; // 1% per second
    uint256 constant BASE_TIME = 1_000_000;

    function setUp() public {
        vm.warp(BASE_TIME);
        token = new MockERC20();
        vault = new StakingVault(address(token), REWARD_RATE);

        // Fund the vault with ETH for rewards/withdrawals
        vm.deal(address(vault), 1000 ether);

        // Mint tokens to users
        token.mint(alice, 1000e18);
        token.mint(bob, 1000e18);
    }

    // Test: basic staking works
    function test_basicStake() public {
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);
        assertEq(vault.balances(alice), 100e18);
        assertEq(vault.totalStaked(), 100e18);
        vm.stopPrank();
    }

    // Test: basic withdrawal works
    function test_basicWithdraw() public {
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);

        uint256 balanceBefore = address(alice).balance;
        vault.withdraw(100e18);
        uint256 balanceAfter = address(alice).balance;

        assertEq(vault.balances(alice), 0);
        assertEq(vault.totalStaked(), 0);
        assertEq(balanceAfter - balanceBefore, 100e18);
        vm.stopPrank();
    }

    // Test: withdrawal reverts on insufficient balance
    function test_withdrawInsufficientBalanceReverts() public {
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);

        vm.expectRevert("Insufficient balance");
        vault.withdraw(200e18);
        vm.stopPrank();
    }

    // Test: claim rewards works
    function test_claimRewards() public {
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);

        vm.warp(BASE_TIME + 10);

        uint256 pending = vault.getPendingRewards(alice);
        assertGt(pending, 0);

        uint256 balanceBefore = address(alice).balance;
        vault.claimRewards();
        uint256 balanceAfter = address(alice).balance;

        assertEq(vault.rewards(alice), 0);
        assertGt(balanceAfter - balanceBefore, 0);
        vm.stopPrank();
    }

    // Test: claim rewards reverts when no rewards
    function test_claimRewardsNoRewardsReverts() public {
        vm.prank(alice);
        vm.expectRevert("No rewards");
        vault.claimRewards();
    }

    // Test: reentrancy on withdraw does NOT drain extra funds
    function test_reentrancyWithdrawBlocked() public {
        MaliciousWithdrawer attacker = new MaliciousWithdrawer(payable(address(vault)));
        vm.deal(address(attacker), 0);

        // Stake from attacker
        token.mint(address(attacker), 100e18);
        vm.startPrank(address(attacker));
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);
        vm.stopPrank();

        uint256 vaultBalanceBefore = address(vault).balance;

        // Attack — should only withdraw 100 ETH, not drain extra
        attacker.attack();

        uint256 vaultBalanceAfter = address(vault).balance;

        // Verify: only 100 ETH was withdrawn (the staked amount)
        assertEq(vaultBalanceBefore - vaultBalanceAfter, 100e18);
        // Verify: attacker balance is 0 after withdraw
        assertEq(vault.balances(address(attacker)), 0);
        // Verify: reentrancy was attempted but failed
        assertGt(attacker.attackCount(), 0);
    }

    // Test: reentrancy on claimRewards does NOT drain extra rewards
    function test_reentrancyClaimRewardsBlocked() public {
        MaliciousRewardClaimer attacker = new MaliciousRewardClaimer(payable(address(vault)));

        // Stake from attacker
        token.mint(address(attacker), 100e18);
        vm.startPrank(address(attacker));
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);
        vm.stopPrank();

        // Advance time to accumulate rewards
        vm.warp(BASE_TIME + 10);

        uint256 expectedRewards = vault.getPendingRewards(address(attacker));
        uint256 vaultBalanceBefore = address(vault).balance;

        // Attack — should only claim rewards once
        attacker.attack();

        uint256 vaultBalanceAfter = address(vault).balance;

        // Verify: only expected rewards were claimed
        assertEq(vaultBalanceBefore - vaultBalanceAfter, expectedRewards);
        // Verify: rewards are zeroed
        assertEq(vault.rewards(address(attacker)), 0);
        // Verify: reentrancy was attempted but failed
        assertGt(attacker.attackCount(), 0);
    }

    // Test: state is updated before external call in withdraw
    function test_stateUpdatedBeforeExternalCall() public {
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);

        assertEq(vault.balances(alice), 100e18);
        vault.withdraw(50e18);
        assertEq(vault.balances(alice), 50e18);
        vm.stopPrank();
    }

    // Test: state is updated before external call in claimRewards
    function test_rewardsZeroedBeforeExternalCall() public {
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);

        vm.warp(BASE_TIME + 10);
        assertGt(vault.getPendingRewards(alice), 0);

        vault.claimRewards();
        assertEq(vault.rewards(alice), 0);
        vm.stopPrank();
    }

    // Test: multiple users can stake and withdraw independently
    function test_multipleUsers() public {
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vault.stake(100e18);
        vm.stopPrank();

        vm.startPrank(bob);
        token.approve(address(vault), type(uint256).max);
        vault.stake(200e18);
        vm.stopPrank();

        assertEq(vault.totalStaked(), 300e18);

        vm.prank(alice);
        vault.withdraw(100e18);

        assertEq(vault.totalStaked(), 200e18);
        assertEq(vault.balances(bob), 200e18);
    }
}
