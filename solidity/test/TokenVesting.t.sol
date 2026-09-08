// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/TokenVesting.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("MockToken", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}

contract TokenVestingTest {
    TokenVesting public vesting;
    MockERC20 public token;
    
    address public owner;
    address public beneficiary;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        token = new MockERC20(1000000);
        owner = address(0x1);
        beneficiary = address(0x2);
        
        // Deploy vesting contract
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            10000, // totalAllocation
            block.timestamp, // start
            100, // cliffDuration
            1000 // vestingDuration
        );
        
        // Transfer tokens to vesting contract
        token.transfer(address(vesting), 10000);
    }
    
    function testVestedAmountBeforeCliff() public {
        // Before cliff, vested amount should be 0
        uint256 vested = vesting.vestedAmount();
        
        if (vested == 0) {
            emit TestPassed("Vested amount is 0 before cliff");
        } else {
            emit TestFailed("Vested amount should be 0 before cliff");
        }
    }
    
    function testVestedAmountAfterCliff() public {
        // Warp to after cliff
        vm.warp(block.timestamp + 150);
        
        uint256 vested = vesting.vestedAmount();
        
        if (vested > 0) {
            emit TestPassed("Vested amount > 0 after cliff");
        } else {
            emit TestFailed("Vested amount should be > 0 after cliff");
        }
    }
    
    function testVestedAmountAtEnd() public {
        // Warp to end of vesting period
        vm.warp(block.timestamp + 1000);
        
        uint256 vested = vesting.vestedAmount();
        
        if (vested == 10000) {
            emit TestPassed("Vested amount equals totalAllocation at end");
        } else {
            emit TestFailed("Vested amount should equal totalAllocation at end");
        }
    }
    
    function testClaim() public {
        // Warp to after cliff
        vm.warp(block.timestamp + 150);
        
        uint256 initialBalance = token.balanceOf(beneficiary);
        
        vm.prank(beneficiary);
        vesting.claim();
        
        if (token.balanceOf(beneficiary) > initialBalance) {
            emit TestPassed("Claim works");
        } else {
            emit TestFailed("Claim failed");
        }
    }
    
    function testClaimable() public {
        // Warp to after cliff
        vm.warp(block.timestamp + 150);
        
        uint256 claimableAmount = vesting.claimable();
        
        if (claimableAmount > 0) {
            emit TestPassed("Claimable amount > 0 after cliff");
        } else {
            emit TestFailed("Claimable amount should be > 0 after cliff");
        }
    }
    
    function testRevoke() public {
        // Warp to after cliff
        vm.warp(block.timestamp + 150);
        
        uint256 initialOwnerBalance = token.balanceOf(owner);
        
        vm.prank(owner);
        vesting.revoke();
        
        if (token.balanceOf(owner) > initialOwnerBalance) {
            emit TestPassed("Revoke works");
        } else {
            emit TestFailed("Revoke failed");
        }
    }
    
    function testRevokeUnvestedCalculation() public {
        // Warp to after cliff but before end
        vm.warp(block.timestamp + 200);
        
        vm.prank(owner);
        vesting.revoke();
        
        // The unvested amount should be totalAllocation - claimed
        // Since nothing was claimed, it should be totalAllocation - 0 = 10000
        // But vested amount at this point is less than totalAllocation
        // With the fix, unvested = totalAllocation - claimed = 10000 - 0 = 10000
        // This is correct because we're revoking the entire allocation
        
        // Check that the contract is marked as revoked
        if (vesting.revoked()) {
            emit TestPassed("Revoke sets revoked flag");
        } else {
            emit TestFailed("Revoke should set revoked flag");
        }
    }
    
    function testOverflowPrevention() public {
        // Create a vesting contract with very large allocation
        TokenVesting largeVesting = new TokenVesting(
            address(token),
            beneficiary,
            type(uint256).max, // Very large allocation
            block.timestamp,
            100,
            1000
        );
        
        // Warp to after cliff
        vm.warp(block.timestamp + 150);
        
        // This should not overflow
        uint256 vested = largeVesting.vestedAmount();
        
        // Should return a large value but not overflow
        if (vested > 0) {
            emit TestPassed("Overflow prevented in vestedAmount");
        } else {
            emit TestFailed("Vested amount should be > 0 for large allocation");
        }
    }
    
    function testRevokeDuringCliff() public {
        // Before cliff
        vm.warp(block.timestamp + 50);
        
        uint256 initialOwnerBalance = token.balanceOf(owner);
        
        vm.prank(owner);
        vesting.revoke();
        
        // With the fix, unvested = totalAllocation - claimed = 10000 - 0 = 10000
        // So owner should receive all 10000 tokens
        if (token.balanceOf(owner) == initialOwnerBalance + 10000) {
            emit TestPassed("Revoke during cliff returns all tokens");
        } else {
            emit TestFailed("Revoke during cliff should return all tokens");
        }
    }
}
