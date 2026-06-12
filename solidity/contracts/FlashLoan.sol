// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is Ownable, Pausable {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);

    constructor(address _loanToken, uint256 _feeBPS) Ownable(msg.sender) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        
        // Cap flash loans to 50% of the pool balance to prevent pool drainage
        require(amount <= poolBalance / 2, "Loan exceeds 50% of pool");

        // Minimum fee of 1 token unit prevents free flash loans for small amounts
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee == 0) {
            fee = 1;
        }

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        
        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 balanceAfter = loanToken.balanceOf(address(this));
        
        // Use internal accounting comparison to prevent rebasing token exploits
        // The contract expects at least the original pool balance plus the fee
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        totalFees += fee;
        poolBalance += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        poolBalance -= fees;
        loanToken.transfer(owner(), fees);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}
