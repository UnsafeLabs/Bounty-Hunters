// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") { _mint(msg.sender, 1000000 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MaliciousContract {
    StakingVault public vault;
    bool public isAttackingWithdraw;
    bool public isAttackingClaim;

    constructor(StakingVault _vault) {
        vault = _vault;
    }

    function attackWithdraw() external {
        isAttackingWithdraw = true;
        vault.withdraw(1 ether);
    }

    function attackClaim() external {
        isAttackingClaim = true;
        vault.claimRewards();
    }

    receive() external payable {
        if (isAttackingWithdraw) {
            isAttackingWithdraw = false;
            vault.withdraw(1 ether);
        }
        if (isAttackingClaim) {
            isAttackingClaim = false;
            vault.claimRewards();
        }
    }
}

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockToken public token;
    MaliciousContract public malicious;
    
    function setUp() public {
        token = new MockToken();
        vault = new StakingVault(address(token), 1 ether);
        malicious = new MaliciousContract(vault);

        token.mint(address(malicious), 100 ether);
        vm.prank(address(malicious));
        token.approve(address(vault), type(uint256).max);

        // Vault has eth
        vm.deal(address(vault), 10 ether);
    }

    function test_WithdrawReentrancy() public {
        vm.prank(address(malicious));
        vault.stake(1 ether);

        vm.expectRevert(bytes("ReentrancyGuardReentrantCall()"));
        malicious.attackWithdraw();
    }

    function test_ClaimReentrancy() public {
        vm.prank(address(malicious));
        vault.stake(1 ether);

        vm.warp(block.timestamp + 10);

        vm.expectRevert(bytes("ReentrancyGuardReentrantCall()"));
        malicious.attackClaim();
    }
}
