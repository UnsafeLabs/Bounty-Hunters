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
    uint256 public expectedBalance; // internal accounting
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(bool isPaused);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        // Uses internal accounting
        uint256 poolBalance = expectedBalance;
        require(amount <= poolBalance / 2, "Loan exceeds 50% of pool balance");
        require(poolBalance >= amount, "Insufficient pool balance");

        uint256 calculatedFee = (amount * feeBPS) / 10000;
        uint256 fee = calculatedFee > 0 ? calculatedFee : 1;

        // expected balance updates to include fee, and temporarily drops by amount out
        expectedBalance = poolBalance + fee;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // check against internal accounting
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= expectedBalance, "Loan not repaid");

        // Sync internal accounting (so rebasing tokens don't steal pool equity)
        // actually if balance is higher, we just sync to actual balance to capture rebasing?
        // Let's just track expected balance strictly to prevent theft. If they overpay, pool keeps it.
        expectedBalance = actualBalance;

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Cannot deposit 0");
        loanToken.transferFrom(msg.sender, address(this), amount);
        expectedBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        expectedBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    function togglePause() external onlyOwner {
        paused = !paused;
        emit Paused(paused);
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
