// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/TokenVesting.sol";

contract TokenVestingTest is Test {
    TokenVesting public vesting;
    MockERC20 public token;
    
    address public owner = address(1);
    address public beneficiary = address(2);
    
    uint256 public constant TOTAL_ALLOCATION = 1000 ether;
    uint256 public constant CLIFF_DURATION = 30 days;
    uint256 public constant VESTING_DURATION = 365 days;
    
    function setUp() public {
        token = new MockERC20("Test Token", "TT");
        
        vm.prank(owner);
        vesting = new TokenVesting(
            address(token),
            beneficiary,
            TOTAL_ALLOCATION,
            block.timestamp,
            CLIFF_DURATION,
            VESTING_DURATION
        );
        
        // Transfer tokens to vesting contract
        token.mint(address(vesting), TOTAL_ALLOCATION);
    }
    
    // Test: No tokens vested before cliff
    function test_NoVestingBeforeCliff() public {
        vm.warp(block.timestamp + CLIFF_DURATION - 1);
        assertEq(vesting.vestedAmount(), 0, "No tokens should be vested before cliff");
    }
    
    // Test: Tokens vested after cliff
    function test_VestingAfterCliff() public {
        vm.warp(block.timestamp + CLIFF_DURATION + 30 days);
        uint256 vested = vesting.vestedAmount();
        assertTrue(vested > 0, "Tokens should be vested after cliff");
    }
    
    // Test: Full vesting after duration
    function test_FullVesting() public {
        vm.warp(block.timestamp + VESTING_DURATION + 1);
        assertEq(vesting.vestedAmount(), TOTAL_ALLOCATION, "All tokens should be vested");
    }
    
    // Test: Claim tokens
    function test_ClaimTokens() public {
        vm.warp(block.timestamp + CLIFF_DURATION + 30 days);
        
        uint256 vested = vesting.vestedAmount();
        uint256 beneficiaryBalanceBefore = token.balanceOf(beneficiary);
        
        vm.prank(beneficiary);
        vesting.claim();
        
        assertEq(token.balanceOf(beneficiary), beneficiaryBalanceBefore + vested, "Beneficiary should receive vested tokens");
    }
    
    // Test: Cannot claim before cliff
    function test_CannotClaimBeforeCliff() public {
        vm.prank(beneficiary);
        vm.expectRevert("Before cliff");
        vesting.claim();
    }
    
    // Test: Revoke vesting
    function test_RevokeVesting() public {
        vm.warp(block.timestamp + CLIFF_DURATION + 30 days);
        
        uint256 vested = vesting.vestedAmount();
        uint256 ownerBalanceBefore = token.balanceOf(owner);
        
        vm.prank(owner);
        vesting.revoke();
        
        // Owner should receive unvested tokens
        uint256 unvested = TOTAL_ALLOCATION - vested;
        assertEq(token.balanceOf(owner), ownerBalanceBefore + unvested, "Owner should receive unvested tokens");
    }
    
    // Test: Cannot revoke twice
    function test_CannotRevokeTwice() public {
        vm.prank(owner);
        vesting.revoke();
        
        vm.prank(owner);
        vm.expectRevert("Already revoked");
        vesting.revoke();
    }
    
    // Test: Overflow protection for large allocations
    function test_OverflowProtection() public {
        // Create vesting with very large allocation
        uint256 largeAllocation = type(uint256).max / 2;
        token.mint(address(this), largeAllocation);
        
        vm.prank(owner);
        TokenVesting largeVesting = new TokenVesting(
            address(token),
            beneficiary,
            largeAllocation,
            block.timestamp,
            CLIFF_DURATION,
            VESTING_DURATION
        );
        
        token.transfer(address(largeVesting), largeAllocation);
        
        vm.warp(block.timestamp + CLIFF_DURATION + 30 days);
        
        // Should not overflow
        uint256 vested = largeVesting.vestedAmount();
        assertTrue(vested > 0, "Large allocation should vest without overflow");
    }
    
    // Test: Claimable amount
    function test_ClaimableAmount() public {
        vm.warp(block.timestamp + CLIFF_DURATION + 30 days);
        
        uint256 claimable = vesting.claimable();
        uint256 vested = vesting.vestedAmount();
        
        assertEq(claimable, vested, "Claimable should equal vested amount");
    }
    
    // Test: Claim updates claimed amount
    function test_ClaimUpdatesClaimed() public {
        vm.warp(block.timestamp + CLIFF_DURATION + 30 days);
        
        uint256 vestedBefore = vesting.vestedAmount();
        
        vm.prank(beneficiary);
        vesting.claim();
        
        assertEq(vesting.claimed(), vestedBefore, "Claimed should be updated");
    }
    
    // Test: Revoke transfers vested tokens to beneficiary
    function test_RevokeTransfersVestedTokens() public {
        vm.warp(block.timestamp + CLIFF_DURATION + 30 days);
        
        uint256 vested = vesting.vestedAmount();
        uint256 beneficiaryBalanceBefore = token.balanceOf(beneficiary);
        
        vm.prank(owner);
        vesting.revoke();
        
        // Beneficiary should receive vested tokens
        assertEq(token.balanceOf(beneficiary), beneficiaryBalanceBefore + vested, "Beneficiary should receive vested tokens on revoke");
    }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }
    
    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
    
    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    
    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
