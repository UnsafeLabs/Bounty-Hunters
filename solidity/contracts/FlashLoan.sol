// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is ReentrancyGuard {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;

    uint256 public poolReserve; // Internal accounting to prevent donation/rebasing manipulation

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PausedStateChanged(bool paused);

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_feeBPS <= 10000, "Fee cannot exceed 100%");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = poolReserve;
        require(balanceBefore >= amount, "Insufficient pool balance");

        // Fixed: Ensure a minimum fee of at least 1 wei if feeBPS > 0 and amount > 0, preventing fee bypass
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee == 0 && feeBPS > 0) {
            fee = 1;
        }

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Fixed: Prevent donation/rebasing token manipulation by doing strict token balance checks relative to internal accounting
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= balanceBefore + fee, "Loan not repaid");

        // Update internal accounting
        poolReserve = balanceBefore + fee;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external nonReentrant {
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        loanToken.transferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        
        // Use actual received amount to prevent issues with fee-on-transfer tokens
        poolReserve += (balanceAfter - balanceBefore);
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        require(poolReserve >= fees, "Insufficient reserves");
        
        totalFees = 0;
        poolReserve -= fees;
        loanToken.transfer(owner, fees);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolReserve;
    }
}
