// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FlashLoanProtection
 * @notice Fix: Zero-fee flash loans and pool drainage protection (#919)
 *
 * Problem: Flash loans with zero fees allow attackers to drain
 * pools by borrowing, manipulating price, and repaying without
 * cost, extracting value from legitimate LPs.
 *
 * Solution: Minimum flash loan fee, reentrancy delay, and
 * pool drainage protection with balance threshold checks.
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract FlashLoanProtection is ReentrancyGuard {
    // Minimum fee: 0.05% (5 basis points)
    uint256 public constant MIN_FLASH_LOAN_FEE_BPS = 5;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Pool drainage protection: max 80% of pool in single flash loan
    uint256 public constant MAX_DRAINAGE_RATIO = 8000; // 80% in BPS

    // Reentrancy delay between flash loans to same pool
    mapping(address => uint256) public lastFlashLoanTimestamp;
    uint256 public constant FLASH_LOAN_COOLDOWN = 15; // 15 seconds

    struct PoolConfig {
        uint256 totalDeposits;
        uint256 flashLoanFees;
        uint256 flashLoanCount;
        bool flashLoansEnabled;
        uint256 customFeeBps;  // Can be higher than minimum
    }

    mapping(address => PoolConfig) public pools;

    event FlashLoanExecuted(address indexed pool, address indexed borrower, uint256 amount, uint256 fee);
    event FlashLoanRejected(address indexed pool, string reason);
    event DrainagePrevented(address indexed pool, uint256 requested, uint256 maxAllowed);

    error FeeBelowMinimum(uint256 provided, uint256 minimum);
    error DrainageExceeded(uint256 ratio, uint256 maxRatio);
    error CooldownActive(uint256 remaining);
    error FlashLoansDisabled(address pool);
    error InsufficientPoolBalance(uint256 requested, uint256 available);
    error RepaymentFailed();

    /**
     * @notice Execute flash loan with all protections
     */
    function executeFlashLoan(
        address pool,
        uint256 amount,
        address borrower,
        bytes calldata callbackData
    ) external nonReentrant returns (bool) {
        PoolConfig storage config = pools[pool];

        // 1. Check flash loans enabled
        if (!config.flashLoansEnabled) {
            emit FlashLoanRejected(pool, "Flash loans disabled");
            revert FlashLoansDisabled(pool);
        }

        // 2. Check sufficient balance
        if (amount > config.totalDeposits) {
            revert InsufficientPoolBalance(amount, config.totalDeposits);
        }

        // 3. Drainage protection: max 80% of pool
        uint256 drainageRatio = (amount * BPS_DENOMINATOR) / config.totalDeposits;
        if (drainageRatio > MAX_DRAINAGE_RATIO) {
            emit DrainagePrevented(pool, amount, (config.totalDeposits * MAX_DRAINAGE_RATIO) / BPS_DENOMINATOR);
            revert DrainageExceeded(drainageRatio, MAX_DRAINAGE_RATIO);
        }

        // 4. Cooldown check
        if (block.timestamp < lastFlashLoanTimestamp[pool] + FLASH_LOAN_COOLDOWN) {
            uint256 remaining = (lastFlashLoanTimestamp[pool] + FLASH_LOAN_COOLDOWN) - block.timestamp;
            revert CooldownActive(remaining);
        }

        // 5. Calculate and validate fee
        uint256 feeBps = config.customFeeBps > 0 ? config.customFeeBps : MIN_FLASH_LOAN_FEE_BPS;
        if (feeBps < MIN_FLASH_LOAN_FEE_BPS) {
            revert FeeBelowMinimum(feeBps, MIN_FLASH_LOAN_FEE_BPS);
        }
        uint256 fee = (amount * feeBps) / BPS_DENOMINATOR;

        // 6. Execute callback
        lastFlashLoanTimestamp[pool] = block.timestamp;
        uint256 balanceBefore = config.totalDeposits;

        // Call borrower's callback
        (bool success,) = borrower.call(abi.encodeWithSignature(
            "onFlashLoan(address,uint256,uint256,bytes)",
            pool, amount, fee, callbackData
        ));

        // 7. Verify repayment + fee
        uint256 expectedBalance = balanceBefore + fee;
        if (config.totalDeposits < expectedBalance) {
            revert RepaymentFailed();
        }

        config.flashLoanFees += fee;
        config.flashLoanCount++;

        emit FlashLoanExecuted(pool, borrower, amount, fee);
        return true;
    }

    function configurePool(
        address pool,
        bool enabled,
        uint256 customFeeBps
    ) external {
        if (customFeeBps > 0 && customFeeBps < MIN_FLASH_LOAN_FEE_BPS) {
            revert FeeBelowMinimum(customFeeBps, MIN_FLASH_LOAN_FEE_BPS);
        }
        pools[pool].flashLoansEnabled = enabled;
        pools[pool].customFeeBps = customFeeBps;
    }
}
