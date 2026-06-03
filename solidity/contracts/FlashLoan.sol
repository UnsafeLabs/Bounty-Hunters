// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    uint256 public poolBalance;

    uint256 public constant MAX_LOAN_PERCENT = 50;
    uint256 public constant MIN_FEE = 1;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Deposited(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);

    constructor(address _loanToken, uint256 _feeBPS) Ownable(msg.sender) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS > 0 && _feeBPS <= 1000, "Invalid fee BPS");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");

        uint256 _poolBalance = poolBalance;
        require(_poolBalance >= amount, "Insufficient pool balance");

        uint256 maxLoan = (_poolBalance * MAX_LOAN_PERCENT) / 100;
        require(amount <= maxLoan, "Exceeds max loan amount");

        uint256 fee = amount * feeBPS / 10000;
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        }

        loanToken.safeTransfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        loanToken.safeTransferFrom(msg.sender, address(this), amount + fee);

        poolBalance += fee;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        loanToken.safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        totalFees = 0;
        poolBalance -= fees;
        loanToken.safeTransfer(owner(), fees);
        emit FeesWithdrawn(owner(), fees);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    function setFeeBPS(uint256 newFeeBPS) external onlyOwner {
        require(newFeeBPS > 0 && newFeeBPS <= 1000, "Invalid fee BPS");
        feeBPS = newFeeBPS;
    }

    function syncBalance() external onlyOwner {
        poolBalance = loanToken.balanceOf(address(this));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
