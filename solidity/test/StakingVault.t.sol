// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract StakingVaultTest is Test {
    StakingVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        vault = new StakingVault(address(token), 1e18);
        token.mint(address(this), 1000 ether);
        token.approve(address(vault), type(uint256).max);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        require(ok);
    }

    receive() external payable {}

    function test_stakeAndWithdraw() public {
        vault.stake(100 ether);
        assertEq(vault.balances(address(this)), 100 ether);
        vault.withdraw(40 ether);
        assertEq(vault.balances(address(this)), 60 ether);
        assertEq(token.balanceOf(address(this)), 940 ether);
    }

    function test_claimRewardsAfterTime() public {
        vault.stake(50 ether);
        vm.warp(block.timestamp + 10);
        vault.claimRewards();
        assertEq(vault.rewards(address(this)), 0);
    }
}
