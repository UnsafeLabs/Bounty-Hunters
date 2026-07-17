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
    uint256 public poolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PausedToggled(bool paused);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= poolBalance / 2, "Exceeds max loan");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;
        require(poolBalance >= amount + totalFees, "Insufficient pool");

        loanToken.transfer(msg.sender, amount);
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);
        loanToken.transferFrom(msg.sender, address(this), amount + fee);

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        poolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    function togglePause() external {
        require(msg.sender == owner, "Not owner");
        paused = !paused;
        emit PausedToggled(paused);
    }

    function syncBalance() external {
        poolBalance = loanToken.balanceOf(address(this)) - totalFees;
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}
