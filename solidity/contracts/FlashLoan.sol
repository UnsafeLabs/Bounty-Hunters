// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    uint256 private constant BPS_DENOMINATOR = 10000;
    uint256 private constant MAX_LOAN_BPS = 5000;

    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    uint256 public accountedPoolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposited(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    modifier nonRebasingOnly() {
        uint256 supplyBefore = loanToken.totalSupply();
        _;
        require(loanToken.totalSupply() == supplyBefore, "Rebasing token unsupported");
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS <= BPS_DENOMINATOR, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        uint256 fee = amount * feeBPS / BPS_DENOMINATOR;
        return fee == 0 ? 1 : fee;
    }

    function maxLoanAmount() public view returns (uint256) {
        return accountedPoolBalance * MAX_LOAN_BPS / BPS_DENOMINATOR;
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused nonRebasingOnly {
        require(amount > 0, "Amount must be > 0");

        uint256 poolBalance = accountedPoolBalance;
        require(loanToken.balanceOf(address(this)) == poolBalance, "Pool accounting mismatch");
        require(poolBalance >= amount, "Insufficient pool balance");
        require(amount <= maxLoanAmount(), "Amount exceeds max loan");

        uint256 fee = calculateFee(amount);

        require(loanToken.transfer(msg.sender, amount), "Transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter == poolBalance + fee, "Loan not repaid");

        accountedPoolBalance = balanceAfter;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore == accountedPoolBalance, "Pool accounting mismatch");

        require(loanToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter == balanceBefore + amount, "Unexpected token balance");

        accountedPoolBalance = balanceAfter;
        emit PoolDeposited(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore == accountedPoolBalance, "Pool accounting mismatch");
        require(fees <= balanceBefore, "Insufficient fees");

        totalFees = 0;
        accountedPoolBalance = balanceBefore - fees;

        require(loanToken.transfer(owner, fees), "Transfer failed");
        require(loanToken.balanceOf(address(this)) == accountedPoolBalance, "Unexpected token balance");

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
        return accountedPoolBalance;
    }
}
