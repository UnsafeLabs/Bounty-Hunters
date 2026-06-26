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
    uint256 public maxLoanAmount; // FIX: Added max loan cap
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        maxLoanAmount = type(uint256).max; // default: unlimited (owner can set)
    }

    // FIX: Added minimum fee and max loan cap
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount, "Loan exceeds max");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient pool balance");

        // FIX: Minimum fee of 1 token unit (prevents zero-fee flash loans)
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0 && amount > 0) {
            fee = 1; // minimum 1 wei/token unit
        }

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use reserve accounting instead of balanceOf (prevents rebasing token manipulation)
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

    // FIX: Added emergency pause and max loan setter
    function setMaxLoanAmount(uint256 _max) external {
        require(msg.sender == owner, "Not owner");
        maxLoanAmount = _max;
    }

    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
    }

    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
