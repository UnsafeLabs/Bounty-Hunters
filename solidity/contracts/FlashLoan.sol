// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable loanToken;
    uint256 public immutable feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public accountedPoolBalance;
    address public immutable owner;
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
        require(_feeBPS <= 10000, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function maxLoanAmount() public view returns (uint256) {
        return accountedPoolBalance / 2;
    }

    // Borrowers must approve amount + fee during the callback. Direct repayment
    // during the callback is rejected so a positive rebase cannot impersonate it.
    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount(), "Loan exceeds 50% of pool");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= accountedPoolBalance, "Pool balance below accounting");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;

        loanToken.safeTransfer(msg.sender, amount);
        require(loanToken.balanceOf(address(this)) == balanceBefore - amount, "Loan transfer changed pool");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.balanceOf(address(this)) == balanceBefore - amount, "Pool changed during callback");
        loanToken.safeTransferFrom(msg.sender, address(this), amount + fee);
        require(loanToken.balanceOf(address(this)) == balanceBefore + fee, "Incorrect repayment");

        accountedPoolBalance += fee;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= accountedPoolBalance, "Pool balance below accounting");
        loanToken.safeTransferFrom(msg.sender, address(this), amount);
        require(loanToken.balanceOf(address(this)) == balanceBefore + amount, "Incorrect deposit");
        accountedPoolBalance += amount;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 fees = totalFees;
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= accountedPoolBalance, "Pool balance below accounting");
        totalFees = 0;
        accountedPoolBalance -= fees;
        loanToken.safeTransfer(owner, fees);
        require(loanToken.balanceOf(address(this)) == balanceBefore - fees, "Incorrect fee withdrawal");
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
