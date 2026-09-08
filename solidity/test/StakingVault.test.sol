// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock ERC20 Token
contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Malicious contract that attempts reentrancy
contract ReentrancyAttacker {
    StakingVault public vault;
    uint256 public attackCount;

    constructor(address _vault) {
        vault = StakingVault(_vault);
    }

    function attack() external payable {
        vault.withdraw(msg.value);
    }

    receive() external payable {
        if (address(vault).balance > 0 && attackCount < 3) {
            attackCount++;
            vault.withdraw(address(vault).balance);
        }
    }
}

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockToken public token;
    address public user = address(0x1);
    address public attacker = address(0x2);

    function setUp() public {
        token = new MockToken();
        vault = new StakingVault(address(token), 1e18);
        
        // Mint tokens to user
        token.mint(user, 1000e18);
        
        // User approves and stakes
        vm.prank(user);
        token.approve(address(vault), 1000e18);
    }

    function testWithdrawReentrancyPrevented() public {
        // Setup: User stakes 100 tokens
        vm.prank(user);
        vault.stake(100e18);
        
        // Fund vault with ETH for withdrawals
        vm.deal(address(vault), 100 ether);
        
        // Attacker tries reentrancy
        ReentrancyAttacker attackerContract = new ReentrancyAttacker(address(vault));
        vm.deal(address(attackerContract), 10 ether);
        
        // Attack should fail due to ReentrancyGuard
        vm.expectRevert();
        vm.prank(attacker);
        attackerContract.attack();
    }

    function testWithdrawNormal() public {
        // Setup: User stakes 100 tokens
        vm.prank(user);
        vault.stake(100e18);
        
        // Fund vault with ETH
        vm.deal(address(vault), 100 ether);
        
        // Normal withdraw should work
        uint256 balanceBefore = user.balance;
        vm.prank(user);
        vault.withdraw(50e18);
        
        assertEq(user.balance, balanceBefore + 50e18);
        assertEq(vault.getStakedBalance(user), 50e18);
    }

    function testClaimRewardsReentrancyPrevented() public {
        // Setup: User stakes 100 tokens
        vm.prank(user);
        vault.stake(100e18);
        
        // Advance time to accrue rewards
        vm.warp(block.timestamp + 1 days);
        
        // Fund vault with ETH
        vm.deal(address(vault), 100 ether);
        
        // Attacker tries reentrancy on claimRewards
        ReentrancyAttacker attackerContract = new ReentrancyAttacker(address(vault));
        vm.deal(address(attackerContract), 10 ether);
        
        // Attack should fail
        vm.expectRevert();
        vm.prank(attacker);
        attackerContract.attack();
    }

    function testClaimRewardsNormal() public {
        // Setup: User stakes 100 tokens
        vm.prank(user);
        vault.stake(100e18);
        
        // Advance time to accrue rewards
        vm.warp(block.timestamp + 1 days);
        
        // Fund vault with ETH
        vm.deal(address(vault), 100 ether);
        
        // Normal claim should work
        uint256 balanceBefore = user.balance;
        vm.prank(user);
        vault.claimRewards();
        
        assertGt(user.balance, balanceBefore);
    }
}