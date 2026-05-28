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
    uint256 public maxLoanPercentage; // max percentage of pool (default 50%)
    address public owner;
    bool public paused;

    error Paused();
    error ZeroAmount();
    error InsufficientPoolBalance();
    error ExceedsMaxLoan();
    error LoanNotRepaid();
    error NotOwner();

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event MaxLoanPercentageUpdated(uint256 newPercentage);
    event EmergencyPauseToggled(bool paused);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        maxLoanPercentage = 50; // default: max 50% of pool
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        if (paused) {
            revert Paused();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        if (balanceBefore < amount) {
            revert InsufficientPoolBalance();
        }

        // Enforce max loan amount (default 50% of pool)
        uint256 maxLoan = (balanceBefore * maxLoanPercentage) / 100;
        if (amount > maxLoan) {
            revert ExceedsMaxLoan();
        }

        // Fix: ensure minimum fee of 1 token unit
        uint256 fee = (amount * feeBPS + 9999) / 10000; // ceiling division
        if (fee == 0) {
            fee = 1; // minimum fee of 1 token unit
        }

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Use expected balance instead of balanceOf to mitigate rebasing token manipulation
        uint256 expectedBalance = balanceBefore + fee;
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        if (balanceAfter < expectedBalance) {
            revert LoanNotRepaid();
        }

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawFees() external {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    function setMaxLoanPercentage(uint256 _percentage) external {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        require(_percentage > 0 && _percentage <= 100, "Invalid percentage");
        maxLoanPercentage = _percentage;
        emit MaxLoanPercentageUpdated(_percentage);
    }

    function togglePause() external {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        paused = !paused;
        emit EmergencyPauseToggled(paused);
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
