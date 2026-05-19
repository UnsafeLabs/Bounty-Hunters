// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Test, console} from "forge-std/Test.sol";
import {TokenVesting} from "../contracts/TokenVesting.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1e36);
    }
}

contract TokenVestingTest is Test {
    MockToken public token;
    TokenVesting public vesting;
    address beneficiary = address(0x123);

    function setUp() public {
        token = new MockToken();
        token.transfer(address(this), 1e27);
    }

    function test_vestedAmount_noOverflow() public {
        uint256 allocation = 1e27;
        uint256 start = block.timestamp;

        vesting = new TokenVesting(address(token), beneficiary, allocation, start, 365 days, 4 * 365 days);
        token.transfer(address(vesting), allocation);

        vm.warp(start + 365 days);
        uint256 vested = vesting.vestedAmount();
        assertEq(vested, allocation / 4, "25% vested after 1 year");
        assertLe(vested, allocation, "Never exceeds total");
    }

    function test_vestedAmount_fullVesting() public {
        uint256 allocation = 1e27;
        uint256 start = block.timestamp;

        vesting = new TokenVesting(address(token), beneficiary, allocation, start, 365 days, 4 * 365 days);
        token.transfer(address(vesting), allocation);

        vm.warp(start + 4 * 365 days + 1);
        assertEq(vesting.vestedAmount(), allocation, "Full vesting at end");
    }

    function test_revokeDuringCliff() public {
        uint256 allocation = 1e27;
        uint256 start = block.timestamp;

        vesting = new TokenVesting(address(token), beneficiary, allocation, start, 365 days, 4 * 365 days);
        token.transfer(address(vesting), allocation);

        vm.warp(start + 180 days);
        uint256 balanceBefore = token.balanceOf(beneficiary);
        uint256 ownerBalance = token.balanceOf(address(this));

        vesting.revoke();

        assertEq(token.balanceOf(beneficiary), balanceBefore, "Nothing during cliff");
        assertEq(token.balanceOf(address(this)) - ownerBalance, allocation, "Owner gets all");
    }

    function test_revokeAfterPartialClaim() public {
        uint256 allocation = 1e27;
        uint256 start = block.timestamp;

        vesting = new TokenVesting(address(token), beneficiary, allocation, start, 365 days, 4 * 365 days);
        token.transfer(address(vesting), allocation);

        vm.warp(start + 2 * 365 days);
        vesting.claim();

        uint256 beneficiaryBalance = token.balanceOf(beneficiary);
        uint256 ownerBalance = token.balanceOf(address(this));

        vesting.revoke();

        assertEq(token.balanceOf(beneficiary), beneficiaryBalance, "Claimed kept");
        uint256 returned = token.balanceOf(address(this)) - ownerBalance;
        assertEq(returned, allocation / 2, "50% returned to owner");
    }

    function test_claimAfterCliff() public {
        uint256 allocation = 1e27;
        uint256 start = block.timestamp;

        vesting = new TokenVesting(address(token), beneficiary, allocation, start, 365 days, 4 * 365 days);
        token.transfer(address(vesting), allocation);

        vm.warp(start + 2 * 365 days);
        vesting.claim();
        assertEq(token.balanceOf(beneficiary), allocation / 4);
        assertEq(vesting.claimed(), allocation / 4);
    }
}
