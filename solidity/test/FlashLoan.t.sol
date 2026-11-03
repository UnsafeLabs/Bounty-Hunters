// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FlashLoan, IFlashLoanReceiver} from "../contracts/FlashLoan.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Token whose balanceOf can change without transfers, like a rebasing token.
contract RebasingToken is ERC20 {
    uint256 public multiplier = 1e18;
    constructor() ERC20("Rebase", "RB") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setMultiplier(uint256 m) external { multiplier = m; }
    function balanceOf(address a) public view override returns (uint256) {
        return (super.balanceOf(a) * multiplier) / 1e18;
    }
}

contract GoodBorrower is IFlashLoanReceiver {
    FlashLoan pool;
    MockToken token;
    bool repay = true;
    constructor(FlashLoan _p, MockToken _t) { pool = _p; token = _t; }
    function setRepay(bool v) external { repay = v; }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external {
        if (repay) token.mint(address(this), amount + fee);
        token.transfer(address(pool), amount + fee);
    }
}

contract FlashLoanTest is Test {
    FlashLoan pool;
    MockToken token;
    GoodBorrower borrower;
    address owner = address(this);

    function setUp() public {
        token = new MockToken();
        pool = new FlashLoan(address(token), 5); // 0.05%
        borrower = new GoodBorrower(pool, token);
        token.mint(address(this), 1_000_000e18);
        token.approve(address(pool), type(uint256).max);
        pool.depositToPool(1_000e18);
    }

    function test_MinimumFeePreventsFreeFlashLoan() public {
        // 100 tokens at 5 bps truncates to 0 -> floor must apply
        uint256 before = token.balanceOf(address(pool));
        vm.prank(address(borrower));
        pool.flashLoan(100, "");
        assertGt(token.balanceOf(address(pool)), before, "pool must earn a fee");
        assertEq(pool.totalFees(), 1, "fee floored to 1 unit");
    }

    function test_LoanAboveHalfPoolReverts() public {
        uint256 maxLoan = pool.maxLoanAmount();
        vm.prank(address(borrower));
        vm.expectRevert(
            abi.encodeWithSelector(FlashLoan.ExceedsMaxLoan.selector, maxLoan + 1, maxLoan)
        );
        pool.flashLoan(maxLoan + 1, "");
    }

    function test_LoanAtExactCapSucceeds() public {
        uint256 maxLoan = pool.maxLoanAmount();
        vm.prank(address(borrower));
        pool.flashLoan(maxLoan, "");
    }

    function test_UnrepaidLoanReverts() public {
        borrower.setRepay(false);
        vm.prank(address(borrower));
        vm.expectRevert();
        pool.flashLoan(100e18, "");
    }

    function test_InternalAccountingIgnoresRebase() public {
        RebasingToken rt = new RebasingToken();
        FlashLoan p2 = new FlashLoan(address(rt), 5);
        rt.mint(address(this), 1_000e18);
        rt.approve(address(p2), type(uint256).max);
        p2.depositToPool(1_000e18);
        uint256 tracked = p2.poolBalance();
        rt.setMultiplier(0.5e18); // balances halve
        assertEq(p2.poolBalance(), tracked, "tracked balance independent of rebase");
    }

    function test_PauseBlocksAndUnpauseRestores() public {
        pool.pause();
        vm.prank(address(borrower));
        vm.expectRevert(FlashLoan.IsPaused.selector);
        pool.flashLoan(100, "");

        pool.unpause();
        vm.prank(address(borrower));
        pool.flashLoan(100, "");
    }

    function test_PauseOnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(FlashLoan.NotOwner.selector);
        pool.pause();
    }

    function test_WithdrawFeesReducesPoolAccounting() public {
        vm.prank(address(borrower));
        pool.flashLoan(100, "");
        uint256 fees = pool.totalFees();
        uint256 trackedBefore = pool.poolBalance();
        pool.withdrawFees();
        assertEq(pool.poolBalance(), trackedBefore - fees);
    }
}
