// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IFlashLoanReceiver {
    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata params
    ) external returns (bool);
}

contract FlashLoan is ReentrancyGuard, Ownable {
    ERC20 public token;
    uint256 public expectedBalance;
    bool public isPaused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event EmergencyPauseToggled(bool isPaused);

    constructor(address _token) {
        token = ERC20(_token);
    }

    function togglePause() external onlyOwner {
        isPaused = !isPaused;
        emit EmergencyPauseToggled(isPaused);
    }

    function flashLoan(
        address receiver,
        uint256 amount,
        bytes calldata params
    ) external nonReentrant {
        require(!isPaused, "Flash loans paused");
        require(amount > 0, "Amount must be > 0");
        
        // Fix for #919: Cap loan amount to 50% to prevent pool drainage
        require(amount <= expectedBalance / 2, "Loan exceeds 50% max limit");

        // Fix for #919: Add minimum fee to prevent zero-fee truncation exploits
        uint256 fee = (amount * 9) / 10000;
        if (fee == 0) {
            fee = 1;
        }

        uint256 balanceBefore = token.balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient pool balance");

        token.transfer(receiver, amount);

        require(
            IFlashLoanReceiver(receiver).executeOperation(
                address(token),
                amount,
                fee,
                params
            ),
            "Flash loan execution failed"
        );

        // Fix for #919: Use internal accounting expectedBalance to block rebasing tokens
        uint256 balanceAfter = token.balanceOf(address(this));
        require(
            balanceAfter >= expectedBalance + fee,
            "Flash loan not repaid with fee"
        );
        
        expectedBalance = balanceAfter;
        emit FlashLoanExecuted(receiver, amount, fee);
    }

    function deposit(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        expectedBalance += amount;
    }
}
