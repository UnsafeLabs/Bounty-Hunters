// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

 * @notice Provides uncollateralized loans within a single transaction
 * @dev Inherits ReentrancyGuard for flash loan protection
 */
contract FlashLoan is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Flash loan fee in basis points (e.g., 30 = 0.3%)
    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);

    /// @notice Total fees collected for pool share calculations
    uint256 public totalFeesAccrued;

    /// @notice Maximum loan amount as percentage of pool (50%)
    uint256 public constant MAX_LOAN_PERCENTAGE = 50;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Emitted on successful flash loan
    event FlashLoaned(
        address indexed token,
    // BUG: Fee truncates to zero for small loan amounts
    // BUG: No max loan amount — can drain entire pool
    // BUG: Uses balanceOf for validation — rebasing tokens can manipulate
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
     * @param _loanAmount The requested loan amount
     */
    function calculateFee(uint256 _loanAmount) public view returns (uint256) {
        uint256 fee = (_loanAmount * feeBPS) / BPS_DENOMINATOR;
        // Minimum fee of 1 token unit to prevent zero-fee flash loans
        if (fee == 0) fee = 1;
        return fee;
    }

    /**
        loanToken.transfer(msg.sender, amount);
     * @param _token The ERC20 token to flash loan
     * @param _amount The amount to flash loan
     */
    function flashLoan(IERC20 _token, uint256 _amount) external nonReentrant whenNotPaused {
        uint256 balanceBefore = _token.balanceOf(address(this));
        uint256 fee = calculateFee(_amount);

        totalFees += fee;
        require(_amount > 0, "FlashLoan: zero amount");
        require(fee > 0, "FlashLoan: zero fee");

        // Prevent pool drainage: cap flash loans at 50% of pool balance
        uint256 maxLoan = balanceBefore / 2;
        require(_amount <= maxLoan, "FlashLoan: exceeds max loan amount");

        // Track internal balance to prevent rebasing token exploits
        uint256 internalBalanceBefore = balanceBefore;
        uint256 totalDue = _amount + fee;

        // Transfer loan amount to borrower

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }
        // Execute callback
        borrower.executeFlashLoan(_token, _amount, fee);

        // Validate repayment using internal accounting to prevent rebasing token exploits
        uint256 internalBalanceAfter = internalBalanceBefore + fee;
        require(_token.balanceOf(address(this)) >= internalBalanceAfter, "FlashLoan: not repaid");

        // Accrue fee for pool share calculations
        totalFeesAccrued += fee;
        emit FlashLoaned(address(_token), _amount, fee, msg.sender);
    }

    /**
     * @notice Emergency pause to disable all flash loan functions
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause to re-enable flash loan functions
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Update the flash loan fee
     * @param _newFeeBPS New fee in basis points
