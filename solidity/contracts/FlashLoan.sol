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
    uint256 public poolBalance; // internal accounting to prevent rebasing token exploits
    address public owner;
    bool public paused;

    uint256 public constant MIN_FEE = 1; // minimum fee of 1 token unit
    uint256 public constant MAX_LOAN_RATIO = 50; // max 50% of pool balance
    uint256 public constant RATIO_DENOMINATOR = 100;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    /// @notice Execute a flash loan with minimum fee enforcement and pool drainage protection
    /// @param amount The amount to borrow
    /// @param data Arbitrary data passed to the receiver callback
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Flash loans paused");
        require(amount > 0, "Amount must be > 0");

        // Pool drainage protection: limit loans to 50% of pool balance
        uint256 maxLoan = (poolBalance * MAX_LOAN_RATIO) / RATIO_DENOMINATOR;
        require(amount <= maxLoan, "Amount exceeds max loan limit");

        // Use internal accounting instead of balanceOf to prevent rebasing token exploits
        uint256 balanceBefore = poolBalance;
        require(balanceBefore >= amount, "Insufficient pool balance");

        // Minimum fee of 1 token unit to prevent zero-fee flash loans
        uint256 calculatedFee = (amount * feeBPS) / 10000;
        uint256 fee = calculatedFee > MIN_FEE ? calculatedFee : MIN_FEE;

        // Update internal accounting before transfer
        poolBalance -= amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Verify repayment using internal accounting, not balanceOf
        // The borrower must repay: amount + fee
        uint256 requiredRepayment = amount + fee;
        poolBalance += requiredRepayment;

        // Double-check with actual balance to catch any inconsistencies
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= poolBalance, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    /// @notice Deposit tokens to the lending pool
    /// @param amount The amount of tokens to deposit
    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount; // track via internal accounting
    }

    /// @notice Withdraw accumulated fees (owner only)
    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        totalFees = 0;
        poolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    /// @notice Emergency pause (owner only)
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause flash loans (owner only)
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Get the pool balance
    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    /// @notice Get the maximum loan amount allowed (50% of pool)
    function getMaxLoanAmount() external view returns (uint256) {
        return (poolBalance * MAX_LOAN_RATIO) / RATIO_DENOMINATOR;
    }
}
