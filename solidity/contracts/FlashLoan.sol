// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;
    uint256 public maxLoanBPS = 5000; // max 50% of pool balance

    uint256 private _poolBalance; // internal accounting to prevent rebasing exploits

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 poolBal = _poolBalance;
        require(poolBal >= amount, "Insufficient pool balance");

        // Max loan cap: 50% of pool balance to prevent drainage
        require(amount <= (poolBal * maxLoanBPS) / 10000, "Exceeds max loan amount");

        // Fix: minimum fee of 1 token unit to prevent zero-fee flash loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Fix: use internal accounting instead of balanceOf to prevent rebasing token exploits
        uint256 newPoolBalance = poolBal - amount + fee;
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= newPoolBalance, "Loan not repaid");

        _poolBalance = newPoolBalance;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
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

    // Emergency pause function
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused();
    }

    function setMaxLoanBPS(uint256 _maxLoanBPS) external onlyOwner {
        require(_maxLoanBPS <= 10000, "Invalid BPS");
        maxLoanBPS = _maxLoanBPS;
    }

    function getPoolBalance() external view returns (uint256) {
        return _poolBalance;
    }
}
