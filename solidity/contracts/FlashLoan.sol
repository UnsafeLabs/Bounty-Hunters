// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;

    /// @dev Internally tracked pool size, independent of balanceOf so rebasing
    /// tokens and donations cannot distort repayment validation.
    uint256 public poolBalance;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event FeeBPSUpdated(uint256 previous, uint256 current);
    event OwnershipTransferred(address indexed previous, address indexed current);

    error NotOwner();
    error IsPaused();
    error NotPaused();
    error ZeroAmount();
    error ExceedsMaxLoan(uint256 amount, uint256 maxLoan);
    error LoanNotRepaid(uint256 expected, uint256 actual);
    error FeeTooHigh();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    /// @notice Fee for a loan, floored at 1 token unit so small loans are never free.
    function _fee(uint256 amount) internal view returns (uint256) {
        uint256 fee = (amount * feeBPS) / 10_000;
        return fee == 0 ? 1 : fee;
    }

    /// @notice Largest single loan: 50% of the tracked pool.
    function maxLoanAmount() public view returns (uint256) {
        return poolBalance / 2;
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        if (paused) revert IsPaused();
        if (amount == 0) revert ZeroAmount();

        uint256 maxLoan = maxLoanAmount();
        if (amount > maxLoan) revert ExceedsMaxLoan(amount, maxLoan);

        uint256 fee = _fee(amount);
        uint256 poolAfterRepayment = poolBalance + fee;

        poolBalance -= amount;
        loanToken.safeTransfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 actual = loanToken.balanceOf(address(this));
        if (actual < poolAfterRepayment) revert LoanNotRepaid(poolAfterRepayment, actual);

        poolBalance = actual;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        loanToken.safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 fees = totalFees;
        if (fees == 0) return;
        totalFees = 0;
        poolBalance -= fees;
        loanToken.safeTransfer(owner, fees);
    }

    function setFeeBPS(uint256 newFeeBPS) external onlyOwner {
        if (newFeeBPS > 1_000) revert FeeTooHigh();
        emit FeeBPSUpdated(feeBPS, newFeeBPS);
        feeBPS = newFeeBPS;
    }

    function pause() external onlyOwner {
        if (paused) revert IsPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}
