// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

/// @title FlashLoan
/// @notice Fee-bearing flash loans with bounded exposure and internal pool accounting.
contract FlashLoan {
    IERC20 public immutable loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    uint256 public accountedPoolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS <= 10_000, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    /// @notice Borrows at most half of the internally accounted pool for one transaction.
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 accountedBefore = accountedPoolBalance;
        require(amount <= accountedBefore / 2, "Exceeds max loan amount");
        require(loanToken.balanceOf(address(this)) >= amount, "Insufficient pool balance");

        // Divide before multiplying so the fee calculation cannot overflow.
        uint256 fee = (amount / 10_000) * feeBPS;
        fee += ((amount % 10_000) * feeBPS) / 10_000;
        if (fee == 0) fee = 1;

        require(loanToken.transfer(msg.sender, amount), "Loan transfer failed");
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Internal accounting is the source of truth; rebasing balance changes cannot
        // create a false repayment or silently increase the amount available to borrow.
        uint256 expectedBalance = accountedBefore + fee;
        require(loanToken.balanceOf(address(this)) >= expectedBalance, "Loan not repaid");
        accountedPoolBalance = expectedBalance;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Deposit failed");
        accountedPoolBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        accountedPoolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Fee transfer failed");
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return accountedPoolBalance;
    }
}
