// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is ReentrancyGuard {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;

    // Internal accounting to prevent rebasing token exploits
    uint256 internal internalPoolBalance;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();
    event Deposited(address indexed depositor, uint256 amount);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = internalPoolBalance;
        require(balanceBefore >= amount, "Insufficient pool balance");

        // FIX: Max loan amount capped at 50% of pool balance to prevent drainage
        require(amount <= balanceBefore / 2, "Loan exceeds 50% of pool");

        // FIX: Minimum fee of 1 token unit prevents free flash loans for small amounts
        uint256 fee = max(amount * feeBPS / 10000, 1);

        // Update internal accounting before transfer
        internalPoolBalance -= amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use internal accounting instead of balanceOf to prevent rebasing token exploits
        uint256 expectedRepay = amount + fee;
        internalPoolBalance += expectedRepay;

        // Verify actual balance matches internal accounting
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= internalPoolBalance, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external whenNotPaused {
        loanToken.transferFrom(msg.sender, address(this), amount);
        internalPoolBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        internalPoolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    // FIX: Emergency pause function
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        if (_paused) {
            emit Paused();
        } else {
            emit Unpaused();
        }
    }

    function getPoolBalance() external view returns (uint256) {
        return internalPoolBalance;
    }

    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
