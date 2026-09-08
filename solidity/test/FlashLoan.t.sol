// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("MockToken", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    address public loanToken;
    uint256 public amount;
    uint256 public fee;
    bytes public data;
    
    function onFlashLoan(address token, uint256 _amount, uint256 _fee, bytes calldata _data) external {
        loanToken = token;
        amount = _amount;
        fee = _fee;
        data = _data;
        
        // Repay the loan + fee
        IERC20(loanToken).approve(msg.sender, amount + fee);
        IERC20(loanToken).transfer(msg.sender, amount + fee);
    }
}

contract FlashLoanTest {
    FlashLoan public flashLoan;
    MockERC20 public token;
    MockFlashLoanReceiver public receiver;
    
    address public owner;
    address public borrower;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        token = new MockERC20(1000000);
        owner = address(0x1);
        borrower = address(0x2);
        receiver = new MockFlashLoanReceiver();
        
        // Deploy flash loan contract
        flashLoan = new FlashLoan(address(token), 100); // 1% fee
        
        // Transfer tokens to flash loan pool
        token.transfer(address(flashLoan), 100000);
    }
    
    function testFlashLoanExecutes() public {
        // Set up receiver
        vm.prank(borrower);
        receiver = new MockFlashLoanReceiver();
        
        // Transfer tokens to receiver for repayment
        token.transfer(address(receiver), 1000);
        
        // Approve receiver to spend tokens
        vm.prank(address(receiver));
        token.approve(address(flashLoan), 1000);
        
        // Execute flash loan
        vm.prank(address(receiver));
        flashLoan.flashLoan(1000, "");
        
        // Check that fee was charged
        if (flashLoan.totalFees() > 0) {
            emit TestPassed("Flash loan executes with fee");
        } else {
            emit TestFailed("Flash loan should charge fee");
        }
    }
    
    function testZeroFeePrevention() public {
        // Create a flash loan with high feeBPS (10000 = 100%)
        FlashLoan highFeeLoan = new FlashLoan(address(token), 10000);
        token.transfer(address(highFeeLoan), 100000);
        
        // Try small amount that would result in 0 fee
        // amount = 1, feeBPS = 10000, so fee = 1 * 10000 / 10000 = 1
        // This should still charge at least minFee
        
        // Transfer tokens to receiver
        token.transfer(address(receiver), 100);
        vm.prank(address(receiver));
        token.approve(address(highFeeLoan), 100);
        
        vm.prank(address(receiver));
        highFeeLoan.flashLoan(1, "");
        
        // With the fix, fee should be at least minFee (1)
        if (highFeeLoan.totalFees() >= 1) {
            emit TestPassed("Zero fee prevented by minFee");
        } else {
            emit TestFailed("Fee should be at least minFee");
        }
    }
    
    function testMaxLoanAmount() public {
        // Set max loan amount
        vm.prank(owner);
        flashLoan.setMaxLoanAmount(5000);
        
        // Try to borrow more than max
        token.transfer(address(receiver), 10000);
        vm.prank(address(receiver));
        token.approve(address(flashLoan), 10000);
        
        try flashLoan.flashLoan(10000, "") {
            emit TestFailed("Should revert when amount exceeds maxLoanAmount");
        } catch {
            emit TestPassed("Max loan amount enforced");
        }
    }
    
    function testDepositToPool() public {
        uint256 initialBalance = flashLoan.getPoolBalance();
        
        token.transfer(address(flashLoan), 1000);
        flashLoan.depositToPool(1000);
        
        if (flashLoan.getPoolBalance() > initialBalance) {
            emit TestPassed("Deposit to pool works");
        } else {
            emit TestFailed("Deposit to pool failed");
        }
    }
    
    function testPause() public {
        vm.prank(owner);
        flashLoan.pause();
        
        if (flashLoan.paused()) {
            emit TestPassed("Pause works");
        } else {
            emit TestFailed("Pause failed");
        }
        
        // Try to execute flash loan while paused
        token.transfer(address(receiver), 1000);
        vm.prank(address(receiver));
        token.approve(address(flashLoan), 1000);
        
        try flashLoan.flashLoan(1000, "") {
            emit TestFailed("Should revert when paused");
        } catch {
            emit TestPassed("Flash loan blocked when paused");
        }
        
        // Unpause
        vm.prank(owner);
        flashLoan.unpause();
        
        if (!flashLoan.paused()) {
            emit TestPassed("Unpause works");
        } else {
            emit TestFailed("Unpause failed");
        }
    }
    
    function testWithdrawFees() public {
        // First, execute a flash loan to generate fees
        token.transfer(address(receiver), 1000);
        vm.prank(address(receiver));
        token.approve(address(flashLoan), 1000);
        
        vm.prank(address(receiver));
        flashLoan.flashLoan(1000, "");
        
        uint256 fees = flashLoan.totalFees();
        uint256 initialBalance = token.balanceOf(owner);
        
        vm.prank(owner);
        flashLoan.withdrawFees();
        
        if (token.balanceOf(owner) == initialBalance + fees) {
            emit TestPassed("Withdraw fees works");
        } else {
            emit TestFailed("Withdraw fees failed");
        }
    }
    
    function testSetMinFee() public {
        vm.prank(owner);
        flashLoan.setMinFee(10);
        
        if (flashLoan.minFee() == 10) {
            emit TestPassed("Set min fee works");
        } else {
            emit TestFailed("Set min fee failed");
        }
    }
    
    function testSetMaxLoanAmount() public {
        vm.prank(owner);
        flashLoan.setMaxLoanAmount(20000);
        
        if (flashLoan.maxLoanAmount() == 20000) {
            emit TestPassed("Set max loan amount works");
        } else {
            emit TestFailed("Set max loan amount failed");
        }
    }
}
