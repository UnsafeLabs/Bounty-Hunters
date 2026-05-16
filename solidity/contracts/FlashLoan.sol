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

    uint256 public poolBalance;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PauseStateChanged(bool paused);

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
        require(poolBalance >= amount, "Insufficient pool balance");
        require(amount <= poolBalance / 2, "Exceeds max loan amount");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 repayAmount = amount + fee;
        require(
            loanToken.balanceOf(address(this)) >= poolBalance - amount + repayAmount,
            "Loan not repaid"
        );

        poolBalance = poolBalance + fee;

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        poolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    function setPause(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseStateChanged(_paused);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    function getContractBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}