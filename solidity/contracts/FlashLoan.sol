// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance;
    address public owner;
    bool public paused;
    bool private loanActive;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrantLoan() {
        require(!loanActive, "Loan active");
        loanActive = true;
        _;
        loanActive = false;
    }

    function flashFee(uint256 amount) public view returns (uint256) {
        if (amount == 0) return 0;
        uint256 fee = Math.mulDiv(amount, feeBPS, BPS_DENOMINATOR);
        return fee == 0 ? 1 : fee;
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrantLoan {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= poolBalance / 2, "Loan exceeds cap");

        uint256 fee = flashFee(amount);
        uint256 repayment = amount + fee;

        require(loanToken.transfer(msg.sender, amount), "Token transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(
            loanToken.transferFrom(msg.sender, address(this), repayment),
            "Loan not repaid"
        );

        totalFees += fee;
        poolBalance += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(
            loanToken.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed"
        );
        poolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        poolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Token transfer failed");
        emit FeesWithdrawn(owner, fees);
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
        return poolBalance;
    }
}
