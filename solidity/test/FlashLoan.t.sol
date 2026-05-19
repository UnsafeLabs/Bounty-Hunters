// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") { _mint(msg.sender, 1000000 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    
    // Malicious rebase function to simulate rebasing tokens during callback
    function rebase(uint256 newBalance, address target) external {
        // Just directly modify balance internally via burn/mint
        uint256 current = balanceOf(target);
        if (newBalance > current) {
            _mint(target, newBalance - current);
        } else if (newBalance < current) {
            _burn(target, current - newBalance);
        }
    }
}

contract BorrowerContract is IFlashLoanReceiver {
    FlashLoan public pool;
    MockToken public token;
    bool public doRebase;
    uint256 public rebaseTarget;
    
    constructor(FlashLoan _pool, MockToken _token) {
        pool = _pool;
        token = _token;
    }

    function setRebase(bool _doRebase, uint256 _rebaseTarget) external {
        doRebase = _doRebase;
        rebaseTarget = _rebaseTarget;
    }

    function takeLoan(uint256 amount) external {
        pool.flashLoan(amount, "");
    }

    function onFlashLoan(address _token, uint256 amount, uint256 fee, bytes calldata data) external override {
        if (doRebase) {
            token.rebase(rebaseTarget, address(pool));
        }
        
        // Repay
        token.transfer(address(pool), amount + fee);
    }
}

contract FlashLoanTest is Test {
    FlashLoan public pool;
    MockToken public token;
    BorrowerContract public borrower;
    address public owner = address(0x11);

    function setUp() public {
        token = new MockToken();
        vm.prank(owner);
        pool = new FlashLoan(address(token), 30); // 0.3%
        borrower = new BorrowerContract(pool, token);

        token.approve(address(pool), type(uint256).max);
        pool.depositToPool(10000 ether);
        
        token.transfer(address(borrower), 1000 ether); // Give borrower some funds to pay fees
    }

    function test_MinimumFee() public {
        // Fee for 100 is 100 * 30 / 10000 = 0. Should be bumped to 1.
        uint256 amount = 100;
        uint256 balBefore = token.balanceOf(address(pool));
        
        borrower.takeLoan(amount);
        
        uint256 balAfter = token.balanceOf(address(pool));
        assertEq(balAfter - balBefore, 1);
        assertEq(pool.totalFees(), 1);
    }

    function test_MaxLoanAmount() public {
        // Pool has 10000 ether
        // 50% is 5000 ether
        vm.expectRevert("Loan exceeds 50% of pool balance");
        borrower.takeLoan(5001 ether);
        
        // Exactly 5000 should work
        borrower.takeLoan(5000 ether);
    }

    function test_RebasingExploitPrevention() public {
        // Pool has 10000 ether
        // Loan 1000 ether
        // Rebase pool balance down during callback
        // The expectedBalance internal accounting should catch it!
        borrower.setRebase(true, 5000 ether);
        
        vm.expectRevert("Loan not repaid");
        borrower.takeLoan(1000 ether);
    }

    function test_PauseUnpause() public {
        vm.prank(owner);
        pool.togglePause();
        
        vm.expectRevert("Paused");
        borrower.takeLoan(1000 ether);

        vm.prank(owner);
        pool.togglePause();
        
        borrower.takeLoan(1000 ether);
    }
}
