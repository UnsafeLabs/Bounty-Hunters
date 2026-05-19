// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Test, console} from "forge-std/Test.sol";
import {FlashLoan} from "../contracts/FlashLoan.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {
        _mint(address(this), 1e36);
    }
}

contract FlashLoanTest is Test {
    MockERC20 public token;
    FlashLoan public flashLoan;

    function setUp() public {
        token = new MockERC20();
        flashLoan = new FlashLoan(address(token), 30);
        token.transfer(address(flashLoan), 1e18);
    }

    function test_flashLoan_basic() public {
        flashLoan.flashLoan(1e15, "");
        assertGe(token.balanceOf(address(flashLoan)), 1e18);
    }

    function test_flashLoan_minFee() public {
        flashLoan.flashLoan(100, "");
        assertGe(token.balanceOf(address(flashLoan)), 1e18 + 1);
    }

    function test_flashLoan_maxLoanCap() public {
        uint256 maxLoan = (1e18 * 5000) / 10000;
        flashLoan.flashLoan(maxLoan, "");
        vm.expectRevert("Exceeds max loan amount");
        flashLoan.flashLoan(maxLoan + 1, "");
    }

    function test_pause() public {
        assertEq(flashLoan.paused(), false);
        flashLoan.pause();
        assertEq(flashLoan.paused(), true);
        vm.expectRevert("Paused");
        flashLoan.flashLoan(1e14, "");
        flashLoan.unpause();
        assertEq(flashLoan.paused(), false);
    }
}
