// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolLiquidity;
    address public owner;
    bool public paused;
    bool private activeLoan;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_feeBPS < BPS_DENOMINATOR, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(!activeLoan, "Flash loan active");
        require(amount > 0, "Amount must be > 0");
        require(amount <= poolLiquidity / 2, "Loan exceeds 50% cap");

        uint256 fee = _calculateFee(amount);
        uint256 repayment = amount + fee;

        activeLoan = true;
        poolLiquidity -= amount;
        require(loanToken.transfer(msg.sender, amount), "Transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.transferFrom(msg.sender, address(this), repayment), "Loan not repaid");

        totalFees += fee;
        poolLiquidity += repayment;
        activeLoan = false;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        poolLiquidity += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        poolLiquidity -= fees;
        require(loanToken.transfer(owner, fees), "Transfer failed");
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

    function getPoolBalance() external view returns (uint256) {
        return poolLiquidity;
    }

    function _calculateFee(uint256 amount) internal view returns (uint256) {
        uint256 fee = amount * feeBPS / BPS_DENOMINATOR;
        if (fee == 0) return 1;
        return fee;
    }
}
