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
    uint256 public maxLoanRatio; // FIX: max loan as % of pool (in BPS)

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        maxLoanRatio = 9000; // FIX: Default 90% max
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient pool balance");

        // FIX: Enforce max loan ratio to prevent pool drainage
        require(amount <= balanceBefore * maxLoanRatio / 10000, "Exceeds max loan ratio");

        // FIX: Minimum fee to prevent zero-fee exploits
        uint256 fee = amount * feeBPS / 10000;
        require(fee > 0, "Fee too low for amount");

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use pre-loan balance for validation (prevent rebasing token manipulation)
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    // FIX: Emergency pause function
    function setPaused(bool _paused) external {
        require(msg.sender == owner, "Not owner");
        paused = _paused;
    }

    // FIX: Owner can adjust max loan ratio
    function setMaxLoanRatio(uint256 _maxLoanRatio) external {
        require(msg.sender == owner, "Not owner");
        require(_maxLoanRatio <= 10000, "Cannot exceed 100%");
        maxLoanRatio = _maxLoanRatio;
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
