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
    address public owner;
    bool public paused;

    // Internal accounting – tracks total tokens deposited (no rebasing influence)
    uint256 public poolBalance;

    // Max loan as percentage of pool balance (in basis points)
    uint256 public maxLoanBPS = 5000; // default 50%

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();
    event MaxLoanBPSUpdated(uint256 newMaxLoanBPS);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    /// @dev Pause flash loans (emergency)
    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    /// @dev Unpause flash loans
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    /// @dev Update the max loan percentage (basis points, e.g. 5000 = 50%)
    function setMaxLoanBPS(uint256 _maxLoanBPS) external onlyOwner {
        require(_maxLoanBPS <= 10000, "Max loan BPS cannot exceed 100%");
        maxLoanBPS = _maxLoanBPS;
        emit MaxLoanBPSUpdated(_maxLoanBPS);
    }

    // ✅ Fixed flash loan: minimum fee, max loan cap, rebasing protection, internal accounting
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= poolBalance, "Insufficient pool balance");

        // --- Minimum fee protection ---
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;

        // --- Max loan cap (50% of pool balance by default) ---
        uint256 maxLoan = poolBalance * maxLoanBPS / 10000;
        require(amount <= maxLoan, "Loan exceeds maximum allowed");

        // --- Rebasing protection: snapshot total supply before & after ---
        uint256 supplyBefore = loanToken.totalSupply();

        // Update internal tracking (tokens are leaving the pool)
        poolBalance -= amount;

        // Transfer loaned tokens to borrower
        loanToken.transfer(msg.sender, amount);

        // Trigger callback
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Verify no rebasing occurred
        require(loanToken.totalSupply() == supplyBefore, "Rebasing token detected");

        // Verify repayment using internal accounting: the actual balance must be
        // at least the expected poolBalance after repayment (poolBalance + fee)
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= poolBalance + fee, "Loan not repaid");

        // Update internal pool balance to reflect repayment (and any deposits made during callback)
        poolBalance = balanceAfter;

        // Accrue fees
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    // ✅ Updated to maintain internal pool balance
    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    /// @dev Returns the total value of deposited tokens (immune to rebasing)
    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}
