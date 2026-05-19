// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;

    uint256 public constant MAX_LOAN_PERCENT = 80; // Cannot borrow more than 80% of pool

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        
        // FIXED: Added pool drainage protection
        require(amount <= (balanceBefore * MAX_LOAN_PERCENT) / 100, "Loan amount too high");

        // FIXED: Use Math.ceilDiv to round up, preventing zero-fee loans for small amounts
        uint256 fee = Math.ceilDiv(amount * feeBPS, 10000);
        require(fee > 0, "Fee evaluates to zero");

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIXED: Enforce explicit pull payment to mitigate rebasing manipulation instead of passive balance check
        require(loanToken.transferFrom(msg.sender, address(this), amount + fee), "Repayment transfer failed");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Deposit failed");
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        require(loanToken.transfer(owner, fees), "Transfer failed");
    }

    // FIXED: Added emergency pause
    function togglePause() external {
        require(msg.sender == owner, "Not owner");
        paused = !paused;
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
