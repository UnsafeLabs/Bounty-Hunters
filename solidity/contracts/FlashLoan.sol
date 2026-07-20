// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

/// @notice Flash loans with min fee, max loan cap, internal accounting (#919).
contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    uint256 public maxLoanBps; // max loan as BPS of tracked pool (default 9000 = 90%)
    uint256 public trackedPool; // internal accounting (not balanceOf)
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(bool status);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        maxLoanBps = 9000;
        owner = msg.sender;
    }

    function setPaused(bool p) external {
        require(msg.sender == owner, "Not owner");
        paused = p;
        emit Paused(p);
    }

    function setMaxLoanBps(uint256 bps) external {
        require(msg.sender == owner, "Not owner");
        require(bps <= 10000, "bps");
        maxLoanBps = bps;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(trackedPool >= amount, "Insufficient pool balance");
        require(amount <= trackedPool * maxLoanBps / 10000, "Exceeds max loan");

        // Fee: at least 1 token unit when feeBPS > 0
        uint256 fee = 0;
        if (feeBPS > 0) {
            fee = (amount * feeBPS + 9999) / 10000;
            if (fee == 0) fee = 1;
        }

        uint256 poolBefore = trackedPool;
        trackedPool -= amount; // effects before callback
        require(loanToken.transfer(msg.sender, amount), "lend");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Pull repayment via transferFrom expectation: borrower must return amount+fee
        require(loanToken.transferFrom(msg.sender, address(this), amount + fee), "repay");
        trackedPool = poolBefore + fee;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(loanToken.transferFrom(msg.sender, address(this), amount), "deposit");
        trackedPool += amount;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        trackedPool -= fees;
        require(loanToken.transfer(owner, fees), "fees");
    }

    function getPoolBalance() external view returns (uint256) {
        return trackedPool;
    }
}
