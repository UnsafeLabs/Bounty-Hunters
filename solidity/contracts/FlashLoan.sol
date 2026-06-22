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
    uint256 public poolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
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

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS <= BPS_DENOMINATOR, "Fee too high");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount(), "Amount exceeds max loan");

        uint256 fee = calculateFee(amount);
        uint256 expectedBalanceBefore = poolBalance + totalFees;
        require(loanToken.balanceOf(address(this)) >= expectedBalanceBefore, "Accounting shortfall");

        poolBalance -= amount;
        require(loanToken.transfer(msg.sender, amount), "Loan transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(
            loanToken.transferFrom(msg.sender, address(this), amount + fee),
            "Repayment transfer failed"
        );

        poolBalance += amount;
        totalFees += fee;
        require(loanToken.balanceOf(address(this)) >= poolBalance + totalFees, "Loan not repaid");

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Deposit transfer failed");
        require(loanToken.balanceOf(address(this)) == balanceBefore + amount, "Unsupported token");
        poolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        require(loanToken.transfer(owner, fees), "Fee transfer failed");
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
        return fee == 0 ? 1 : fee;
    }

    function maxLoanAmount() public view returns (uint256) {
        return poolBalance / 2;
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}
