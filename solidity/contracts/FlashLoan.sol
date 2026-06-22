// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    address public owner;
    bool public paused;

    // Internal accounting to prevent rebasing token exploits
    uint256 private _poolBalance;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event EmergencyPaused(address indexed by);
    event EmergencyUnpaused(address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount(), "Exceeds max loan amount");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1; // Minimum fee prevents free flash loans

        uint256 balanceBefore = _poolBalance;
        require(balanceBefore >= amount, "Insufficient pool balance");

        _poolBalance = balanceBefore - amount - fee;
        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.balanceOf(address(this)) >= _poolBalance + amount + fee, "Loan not repaid");

        _poolBalance += amount + fee;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function maxLoanAmount() public view returns (uint256) {
        return _poolBalance / 2; // Max 50% of pool
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        _poolBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        _poolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    function pause() external onlyOwner {
        paused = true;
        emit EmergencyPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit EmergencyUnpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return _poolBalance;
    }

    // Sync internal balance with actual token balance (for donations etc)
    function syncBalance() external onlyOwner {
        _poolBalance = loanToken.balanceOf(address(this));
    }
}
