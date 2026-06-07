// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MAX_LOAN_BPS = 5_000;

    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance;
    address public owner;
    bool public paused;
    bool private loanInProgress;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS < BPS_DENOMINATOR, "Invalid fee");

        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(!loanInProgress, "Loan in progress");
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount(), "Loan exceeds cap");
        require(poolBalance >= amount, "Insufficient pool balance");

        uint256 fee = _flashFee(amount);

        loanInProgress = true;
        poolBalance -= amount;

        require(loanToken.transfer(msg.sender, amount), "Loan transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.transferFrom(msg.sender, address(this), amount + fee), "Repayment failed");

        poolBalance += amount + fee;
        totalFees += fee;
        loanInProgress = false;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Deposit failed");

        poolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");

        uint256 fees = totalFees;
        require(fees > 0, "No fees");

        totalFees = 0;
        poolBalance -= fees;

        require(loanToken.transfer(owner, fees), "Fee transfer failed");
        emit FeesWithdrawn(owner, fees);
    }

    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit Paused(owner);
    }

    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit Unpaused(owner);
    }

    function maxLoanAmount() public view returns (uint256) {
        return (poolBalance * MAX_LOAN_BPS) / BPS_DENOMINATOR;
    }

    function flashFee(uint256 amount) external view returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        return _flashFee(amount);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    function _flashFee(uint256 amount) internal view returns (uint256) {
        uint256 fee = (amount * feeBPS) / BPS_DENOMINATOR;
        return fee == 0 ? 1 : fee;
    }
}
