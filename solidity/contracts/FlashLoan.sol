// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public totalAssets; // Internal accounting to prevent rebasing exploits
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PausedStateChanged(bool paused);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        // Limit flash loans to 50% of the pool balance to prevent pool drainage
        require(amount <= totalAssets / 2, "Loan exceeds 50% of pool");

        uint256 balanceBefore = totalAssets;

        // Calculate fee with a minimum fee of 1 token unit
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee == 0) {
            fee = 1;
        }

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Verify repayment using internal accounting + required fee
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        // Update internal accounting
        totalAssets = balanceAfter;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        loanToken.transferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        totalAssets += (balanceAfter - balanceBefore);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        totalAssets -= fees;
        loanToken.transfer(owner, fees);
    }

    function getPoolBalance() external view returns (uint256) {
        return totalAssets;
    }
}
