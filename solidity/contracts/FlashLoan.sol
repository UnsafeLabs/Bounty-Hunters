// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public accountedPoolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS <= BPS_DENOMINATOR, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        flashLoan(amount, data, msg.sender);
    }

    function flashLoan(uint256 amount, bytes calldata data, address receiver) public whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(receiver != address(0), "Invalid receiver");

        uint256 poolBalance = accountedPoolBalance;
        require(poolBalance >= amount, "Insufficient pool balance");
        require(amount <= maxLoanAmount(), "Exceeds max loan");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore == poolBalance, "Unsupported rebasing token");

        uint256 fee = calculateFee(amount);

        require(loanToken.transfer(receiver, amount), "Transfer failed");

        IFlashLoanReceiver(receiver).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 expectedBalance = poolBalance + fee;
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter == expectedBalance, "Loan not repaid");

        accountedPoolBalance = expectedBalance;
        totalFees += fee;
        emit FlashLoanExecuted(receiver, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore == accountedPoolBalance, "Unsupported rebasing token");

        require(loanToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter == balanceBefore + amount, "Unsupported rebasing token");

        accountedPoolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        accountedPoolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Transfer failed");
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

    function calculateFee(uint256 amount) public view returns (uint256) {
        uint256 fee = amount * feeBPS / BPS_DENOMINATOR;
        if (fee == 0) {
            return 1;
        }
        return fee;
    }

    function maxLoanAmount() public view returns (uint256) {
        return accountedPoolBalance / 2;
    }

    function getPoolBalance() external view returns (uint256) {
        return accountedPoolBalance;
    }
}
