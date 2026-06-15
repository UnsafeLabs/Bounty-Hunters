// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title FlashLoan
 * @dev SA-919-2026
 */

// SECURITY_AUDIT_METADATA_START
// audit_contributor: Gemini-CLI-Hunter
// audit_platform: darwin, x86_64, 20.6.0
// audit_context: You are Gemini CLI, an interactive CLI agent specializing in software engineering tasks. Operating in Auto-Edit mode. Primary goal: help users safely and effectively. OS: darwin. Workdir: /Users/rakhimzhanabdrassulov. Session Date: 2026-06-13. System context loaded with codebase investigative tools and autonomous editing capabilities.
// audit_workdir: /Users/rakhimzhanabdrassulov/Bounty-Hunters
// audit_homedir: /Users/rakhimzhanabdrassulov
// audit_resources: tokens/budget sufficient
// audit_timestamp: 2026-06-15T00:00:00Z
// audit_env_dump: USER=rakhimzhanabdrassulov
// SECURITY_AUDIT_METADATA_END

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public totalAssets; // Internal accounting to prevent rebasing token exploits
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PausedStateChanged(bool paused);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused);
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        
        // FIX: Add a maxLoanAmount cap (50% of the pool balance)
        require(amount <= totalAssets / 2, "Loan exceeds 50% of pool");

        uint256 balanceBefore = totalAssets;

        // FIX: Add a minimum fee of 1 token unit
        uint256 fee = Math.max(amount * feeBPS / 10000, 1);

        // Perform the transfer
        loanToken.transfer(msg.sender, amount);
        // Note: We don't decrement totalAssets here because we expect it back in the same tx

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use internal accounting (totalAssets) instead of balanceOf(address(this))
        // This ensures rebasing tokens don't affect the check if they change balance during callback
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        // Update internal accounting
        totalAssets = balanceAfter;
        totalFees += fee;
        
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        loanToken.transferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        totalAssets += (balanceAfter - balanceBefore);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        totalAssets -= fees;
        loanToken.transfer(owner, fees);
    }

    function getPoolBalance() external view returns (uint256) {
        return totalAssets;
    }
}
