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

    // Internal accounting to prevent rebasing token exploits
    uint256 internal _poolBalance;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    /// @notice Execute a flash loan with fee, cap, and pause protection
    /// @param amount The amount to borrow
    /// @param data Arbitrary data passed to the receiver callback
    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");

        // Cap: max 50% of pool balance to prevent drainage
        require(amount <= _poolBalance / 2, "Exceeds 50% pool cap");

        // Minimum fee of 1 token unit prevents free flash loans for small amounts
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        // Use internal accounting instead of balanceOf for rebasing token safety
        uint256 balanceBefore = _poolBalance;

        // Transfer loan to borrower
        _poolBalance -= amount;
        loanToken.transfer(msg.sender, amount);

        // Execute callback
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Repayment: borrower must return amount + fee
        uint256 repayment = amount + fee;
        loanToken.transferFrom(msg.sender, address(this), repayment);

        // Update internal accounting
        _poolBalance += fee;

        require(_poolBalance >= balanceBefore + fee, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        _poolBalance += amount;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        _poolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    /// @notice Emergency pause - disables all flash loan functions
    function pause() external {
        require(msg.sender == owner, "Not owner");
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    /// @notice Unpause - re-enables flash loan functions
    function unpause() external {
        require(msg.sender == owner, "Not owner");
        require(paused, "Not paused");
        paused = false;
        emit Unpaused();
    }

    function getPoolBalance() external view returns (uint256) {
        return _poolBalance;
    }
}
