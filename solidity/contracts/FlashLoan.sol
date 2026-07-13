// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is Ownable {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance;
    bool public paused;

    uint256 public constant MAX_FEE_BPS = 1000; // 10% max fee
    uint256 public constant MAX_LOAN_RATIO = 50; // 50% of pool

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();
    event FeeUpdated(uint256 oldFeeBPS, uint256 newFeeBPS);

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) Ownable(msg.sender) {
        require(_feeBPS <= MAX_FEE_BPS, "Fee too high");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");

        // Cap loan at MAX_LOAN_RATIO% of pool balance
        uint256 maxLoan = poolBalance * MAX_LOAN_RATIO / 100;
        require(amount <= maxLoan, "Exceeds max loan amount");

        // Minimum fee of 1 token unit prevents zero-fee flash loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;

        uint256 balanceBefore = poolBalance;

        // Use internal accounting instead of balanceOf for rebasing token safety
        poolBalance -= amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Verify repayment using internal accounting
        uint256 expectedBalance = balanceBefore + fee;
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= expectedBalance, "Loan not repaid");

        poolBalance = actualBalance;
        totalFees += fee;

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

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        require(paused, "Already unpaused");
        paused = false;
        emit Unpaused();
    }

    function updateFee(uint256 _newFeeBPS) external onlyOwner {
        require(_newFeeBPS <= MAX_FEE_BPS, "Fee too high");
        uint256 oldFee = feeBPS;
        feeBPS = _newFeeBPS;
        emit FeeUpdated(oldFee, _newFeeBPS);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}
