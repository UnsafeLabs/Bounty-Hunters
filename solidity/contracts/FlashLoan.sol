// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title FlashLoan
/// @notice Contract for providing uncollateralized loans within a single transaction
/// @dev Implements flash loan functionality with security measures
contract FlashLoan is ReentrancyGuard, Ownable, Pausable {
    mapping(address => uint256) private poolBalances;
    mapping(address => uint256) public feesEarned;
    uint256 public feeBPS = 30; // 0.3% fee
    uint256 public maxLoanPercentage = 50; // 50% max loan cap
    
    // Events
    event FlashLoanExecuted(address indexed receiver, uint256 amount, uint256 fee);
    event FeeUpdated(uint256 newFeeBPS);
    event MaxLoanPercentageUpdated(uint256 newMaxPercentage);
    
    constructor() {
        // Initialize with zero values, mappings will be set up dynamically
    }
    
    /// @notice Update fee basis points
    /// @param newFeeBPS New fee in basis points
    function setFeeBPS(uint256 newFeeBPS) external onlyOwner {
        feeBPS = newFeeBPS;
        emit FeeUpdated(newFeeBPS);
    }
    
    /// @notice Update maximum loan percentage
    /// @param newMaxLoanPercentage New maximum loan percentage (0-100)
    function setMaxLoanPercentage(uint256 newMaxLoanPercentage) external onlyOwner {
        maxLoanPercentage = newMaxLoanPercentage;
        emit MaxLoanPercentageUpdated(newMaxLoanPercentage);
    }
    
    /// @notice Execute a flash loan
    /// @param tokenAddress Token to borrow
    /// @param amount Amount to borrow
    /// @param data Callback data
    function flashLoan(
        address tokenAddress,
        uint256 amount,
        bytes calldata data
    ) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(tokenAddress != address(0), "Invalid token address");
        
        // Check if loan amount exceeds max cap (50% of pool balance)
        uint256 poolBalance = IERC20(tokenAddress).balanceOf(address(this));
        require(amount <= (poolBalance * maxLoanPercentage) / 100, "Loan amount exceeds pool cap");
        
        // Calculate fee with minimum of 1
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee == 0 && amount > 0) {
            fee = 1; // Minimum fee of 1 token unit
        }
        
        uint256 balanceBefore = IERC20(tokenAddress).balanceOf(address(this));
        uint256 feeBalanceBefore = IERC20(tokenAddress).balanceOf(address(this));
        
        // Transfer tokens to borrower
        IERC20(tokenAddress).transfer(msg.sender, amount);
        
        // Execute callback
        (bool success, ) = msg.sender.call(data);
        require(success, "Flash loan callback failed");
        
        // Check final balance includes fee
        uint256 balanceAfter = IERC20(tokenAddress).balanceOf(address(this));
        uint256 expectedBalance = balanceBefore + fee;
        require(balanceAfter >= expectedBalance, "Insufficient fee paid");
        
        // Update fees earned
        feesEarned[tokenAddress] += fee;
        
        // Record fee in pool
        poolBalances[tokenAddress] = poolBalances[tokenAddress] + fee;
    }
    
    /// @notice Set emergency pause state
    /// @param paused Whether to pause or unpause
    function setPaused(bool paused) external onlyOwner {
        if (paused) {
            _pause();
        } else {
            _unpause();
        }
    }
}
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    // BUG: Fee truncates to zero for small loan amounts
    // BUG: No max loan amount — can drain entire pool
    // BUG: Uses balanceOf for validation — rebasing tokens can manipulate
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient pool balance");

        // BUG: Truncates to 0 when amount < 10000/feeBPS
        uint256 fee = amount * feeBPS / 10000;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // BUG: balanceOf can be manipulated by rebasing tokens
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

    // BUG: No emergency pause function
    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
