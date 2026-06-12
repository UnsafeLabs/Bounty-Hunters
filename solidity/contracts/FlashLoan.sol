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

    // FIX: Internal accounting to prevent rebasing token exploits
    uint256 public internalBalance;

    // FIX: Maximum loan amount as percentage of pool (basis points, 5000 = 50%)
    uint256 public constant MAX_LOAN_BPS = 5000;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    // FIX: Minimum fee prevents free flash loans for small amounts
    // FIX: Max loan cap at 50% of pool prevents drainage
    // FIX: Internal accounting prevents rebasing token exploits
    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");

        // FIX: Use internal accounting instead of balanceOf
        uint256 _internalBalance = internalBalance;
        require(_internalBalance >= amount, "Insufficient pool balance");

        // FIX: Cap loans at 50% of pool to prevent drainage
        uint256 maxLoan = _internalBalance * MAX_LOAN_BPS / 10000;
        require(amount <= maxLoan, "Exceeds max loan amount");

        // FIX: Minimum fee of 1 token unit prevents zero-fee loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;

        // Update internal accounting before transfer
        internalBalance = _internalBalance - amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Update internal accounting after repayment
        // We check the actual balance to ensure the tokens arrived,
        // but use internal accounting for the minimum required
        uint256 actualBalance = loanToken.balanceOf(address(this));
        uint256 requiredBalance = _internalBalance + fee;
        require(actualBalance >= requiredBalance, "Loan not repaid");

        // Sync internal balance with actual (in case of extra deposits)
        internalBalance = actualBalance;

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        // FIX: Track internal balance on deposit
        internalBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        internalBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    // FIX: Emergency pause function
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return internalBalance;
    }
}
