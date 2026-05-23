// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract FlashLoan is ReentrancyGuard {
    IERC20 public poolToken;
    uint256 public poolBalance;
    uint256 public constant FEE_BPS = 9; // 0.09%
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public maxFlashLoanPercent = 50; // Max 50% of pool

    event FlashLoan(address indexed receiver, uint256 amount, uint256 fee);
    event Deposited(address indexed depositor, uint256 amount);

    constructor(address _poolToken) {
        poolToken = IERC20(_poolToken);
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Must deposit > 0");
        poolToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    // FIX: Add pool drainage protection and proper fee enforcement
    function flashLoan(uint256 amount, address receiver, bytes calldata data) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        // FIX: Limit flash loan to max percentage of pool to prevent drainage
        uint256 maxAmount = (poolBalance * maxFlashLoanPercent) / 100;
        require(amount <= maxAmount, "Amount exceeds max flash loan");

        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 balanceBefore = poolToken.balanceOf(address(this));

        // Transfer tokens to receiver
        poolToken.transfer(receiver, amount);

        // Execute receiver's callback
        (bool success, ) = receiver.call(data);
        require(success, "Callback failed");

        // FIX: Verify repayment with fee
        uint256 balanceAfter = poolToken.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Flash loan not repaid with fee");

        // Update pool balance
        poolBalance = balanceAfter;

        emit FlashLoan(receiver, amount, fee);
    }

    function setMaxFlashLoanPercent(uint256 newPercent) external {
        require(newPercent > 0 && newPercent <= 80, "Invalid percent");
        maxFlashLoanPercent = newPercent;
    }
}
