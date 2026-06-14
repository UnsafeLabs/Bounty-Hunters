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
    uint256 public totalAssets; // Internal accounting to prevent rebasing manipulation
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(bool isPaused);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        totalAssets = 0;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 maxLoanAmount = totalAssets / 2;
        require(amount <= maxLoanAmount, "Loan exceeds 50% of pool");

        require(totalAssets >= amount, "Insufficient pool balance");

        uint256 calculatedFee = (amount * feeBPS) / 10000;
        uint256 fee = calculatedFee > 0 ? calculatedFee : 1;

        loanToken.transfer(msg.sender, amount);
        totalAssets -= amount;

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Internal accounting check to prevent rebasing exploits
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= totalAssets + amount + fee, "Loan not repaid");
        
        totalAssets = balanceAfter; // Sync internal accounting
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(!paused, "Paused");
        loanToken.transferFrom(msg.sender, address(this), amount);
        totalAssets += amount;
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
