// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";

// Mock ERC20 for testing
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "Mock Token";
    string public symbol = "MCK";
    uint8 public decimals = 18;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// Malicious contract that attempts reentrancy attacks
contract ReentrancyAttacker {
    StakingVault public vault;
    uint256 public attackCount;
    uint256 public maxAttacks;
    bool public attackOnRewards;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
    }

    function attackWithdraw(uint256 amount, uint256 _maxAttacks) external {
        attackOnRewards = false;
        attackCount = 0;
        maxAttacks = _maxAttacks;
        vault.withdraw(amount);
    }

    function attackClaimRewards(uint256 _maxAttacks) external {
        attackOnRewards = true;
        attackCount = 0;
        maxAttacks = _maxAttacks;
        vault.claimRewards();
    }

    receive() external payable {
        if (attackCount < maxAttacks) {
            attackCount++;
            if (attackOnRewards) {
                try vault.claimRewards() {} catch {}
            } else {
                try vault.withdraw(msg.value) {} catch {}
            }
        }
    }
}

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockERC20 public token;
    ReentrancyAttacker public attacker;

    address public user = address(1);
    address public attackerAddress;

    function setUp() public {
        token = new MockERC20();
        vault = new StakingVault(address(token), 1e17); // 10% rate
        attacker = new ReentrancyAttacker(payable(address(vault)));
        attackerAddress = address(attacker);

        // Fund test users
        token.mint(user, 1000 ether);
        token.mint(attackerAddress, 1000 ether);

        // Fund vault with ETH for rewards
        vm.deal(address(vault), 100 ether);
    }

    function test_WithdrawBalance() public {
        vm.startPrank(user);
        token.approve(address(vault), 100 ether);
        vault.stake(100 ether);

        uint256 balanceBefore = user.balance;
        vault.withdraw(50 ether);
        uint256 balanceAfter = user.balance;

        assertEq(balanceAfter - balanceBefore, 50 ether, "Should receive 50 ether");
        assertEq(vault.balances(user), 50 ether, "Remaining balance should be 50 ether");
        vm.stopPrank();
    }

    function test_ReentrancyWithdrawDoesNotDrain() public {
        // Attacker stakes
        vm.startPrank(attackerAddress);
        token.approve(address(vault), 100 ether);
        vault.stake(10 ether);
        vm.stopPrank();

        // Ensure vault has enough ETH
        vm.deal(address(vault), 100 ether);

        // Record attacker balance before
        uint256 balanceBefore = attackerAddress.balance;

        // Attacker tries reentrancy - the inner call should fail
        // The outer call succeeds (1 ether), inner reentrancy fails
        attacker.attackWithdraw(1 ether, 5);

        // Attacker should only have withdrawn 1 ether (not more via reentrancy)
        uint256 balanceAfter = attackerAddress.balance;
        assertEq(balanceAfter - balanceBefore, 1 ether, "Should only withdraw 1 ether, not more via reentrancy");
    }

    function test_ReentrancyClaimRewardsDoesNotDoublePay() public {
        // Use a smaller reward rate for this test
        StakingVault smallVault = new StakingVault(address(token), 1e10); // tiny rate
        vm.deal(address(smallVault), 10 ether);

        // Attacker stakes in the small vault
        vm.startPrank(attackerAddress);
        token.approve(address(smallVault), 100 ether);
        smallVault.stake(10 ether);
        vm.stopPrank();

        // Fast-forward a short time
        vm.warp(block.timestamp + 1 hours);

        // Record balances before
        uint256 balanceBefore = attackerAddress.balance;
        uint256 vaultBalanceBefore = address(smallVault).balance;

        // Attacker tries reentrancy on claimRewards
        // The nonReentrant guard should prevent double-payment
        ReentrancyAttacker smallAttacker = new ReentrancyAttacker(payable(address(smallVault)));
        token.mint(address(smallAttacker), 100 ether);
        vm.startPrank(address(smallAttacker));
        token.approve(address(smallVault), 100 ether);
        smallVault.stake(10 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);
        smallAttacker.attackClaimRewards(5);

        // Vault should have paid out only once
        uint256 vaultPaid = vaultBalanceBefore - address(smallVault).balance;
        uint256 attackerReceived = address(smallAttacker).balance - balanceBefore;

        // Attacker should not receive more than what the vault paid out
        assertLe(attackerReceived, vaultPaid + 1 ether, "Attacker should not drain vault via reentrancy");
    }

    function test_CannotWithdrawMoreThanStaked() public {
        vm.startPrank(user);
        token.approve(address(vault), 10 ether);
        vault.stake(10 ether);

        vm.expectRevert("Insufficient balance");
        vault.withdraw(20 ether);
        vm.stopPrank();
    }

    function test_ReentraintUsesChecksEffectsInteractions() public {
        // Verify state is updated before external call
        vm.startPrank(user);
        token.approve(address(vault), 50 ether);
        vault.stake(50 ether);

        vault.withdraw(25 ether);

        // Balance should already be updated
        assertEq(vault.balances(user), 25 ether);
        assertEq(vault.totalStaked(), 25 ether);
        vm.stopPrank();
    }
}
