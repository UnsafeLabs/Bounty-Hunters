// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TokenVesting
 * @notice Fix: Integer overflow in TokenVesting calculation for
 * large allocation amounts (#917)
 *
 * Problem: Multiplication of large allocation amounts by time
 * numerator can overflow uint256, causing incorrect vesting
 * calculations and potential fund loss.
 *
 * Solution: Use SafeCast, check before multiply, split
 * large operations, and use OZ SafeMath-like patterns.
 */

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract TokenVesting {
    using SafeCast for uint256;

    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 startTimestamp;
        uint256 durationSeconds;
        uint256 releasedAmount;
        bool revocable;
        bool revoked;
    }

    mapping(bytes32 => VestingSchedule) public vestingSchedules;
    mapping(address => uint256) public holderVestingCount;

    uint256 public totalVestingAmount;
    uint256 public vestingScheduleCount;

    event VestingScheduleCreated(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 startTimestamp,
        uint256 durationSeconds
    );
    event Released(bytes32 indexed scheduleId, uint256 amount);
    event Revoked(bytes32 indexed scheduleId);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroDuration();
    error InvalidDuration();
    error InsufficientReleasedAmount();
    error ScheduleNotFound(bytes32 scheduleId);
    error ScheduleRevoked(bytes32 scheduleId);
    error ScheduleNotRevocable(bytes32 scheduleId);

    /**
     * @notice Create a new vesting schedule with overflow-safe calculations
     */
    function createVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTimestamp,
        uint256 durationSeconds,
        bool revocable
    ) external returns (bytes32) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (totalAmount == 0) revert ZeroAmount();
        if (durationSeconds == 0) revert ZeroDuration();

        // Validate no overflow: totalAmount + totalVestingAmount must fit uint256
        require(
            totalVestingAmount + totalAmount >= totalVestingAmount,
            "Vesting: total overflow"
        );

        bytes32 scheduleId = keccak256(abi.encodePacked(
            beneficiary, vestingScheduleCount, block.timestamp
        ));

        vestingSchedules[scheduleId] = VestingSchedule({
            beneficiary: beneficiary,
            totalAmount: totalAmount,
            startTimestamp: startTimestamp,
            durationSeconds: durationSeconds,
            releasedAmount: 0,
            revocable: revocable,
            revoked: false
        });

        totalVestingAmount += totalAmount;
        holderVestingCount[beneficiary]++;
        vestingScheduleCount++;

        emit VestingScheduleCreated(
            scheduleId, beneficiary, totalAmount, startTimestamp, durationSeconds
        );

        return scheduleId;
    }

    /**
     * @notice Calculate vested amount — overflow-safe
     *
     * Instead of: totalAmount * (time - start) / duration
     * Which can overflow for large totalAmount * timeDelta,
     * we use: totalAmount / duration * (time - start) when duration divides evenly,
     * or Math.mulDiv for safe multiply-then-divide.
     */
    function computeVestedAmount(
        bytes32 scheduleId,
        uint256 atTimestamp
    ) public view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[scheduleId];

        if (schedule.totalAmount == 0) revert ScheduleNotFound(scheduleId);
        if (schedule.revoked) revert ScheduleRevoked(scheduleId);

        if (atTimestamp < schedule.startTimestamp) {
            return 0;
        }

        uint256 elapsed = atTimestamp - schedule.startTimestamp;

        if (elapsed >= schedule.durationSeconds) {
            return schedule.totalAmount;
        }

        // Safe calculation using Math.mulDiv (no overflow)
        // vested = totalAmount * elapsed / duration
        return Math.mulDiv(
            schedule.totalAmount,
            elapsed,
            schedule.durationSeconds,
            Math.Rounding.Down
        );
    }

    /**
     * @notice Release vested tokens — overflow-safe
     */
    function release(bytes32 scheduleId, uint256 amount) external {
        VestingSchedule storage schedule = vestingSchedules[scheduleId];

        if (schedule.totalAmount == 0) revert ScheduleNotFound(scheduleId);
        if (schedule.revoked) revert ScheduleRevoked(scheduleId);

        uint256 vested = computeVestedAmount(scheduleId, block.timestamp);

        // Safe subtraction: vested - releasedAmount (always >= 0)
        uint256 releasable = vested - schedule.releasedAmount;

        if (amount > releasable) revert InsufficientReleasedAmount();

        // Safe addition for releasedAmount
        schedule.releasedAmount += amount;

        emit Released(scheduleId, amount);
    }

    /**
     * @notice Revoke a vesting schedule (if revocable)
     */
    function revoke(bytes32 scheduleId) external {
        VestingSchedule storage schedule = vestingSchedules[scheduleId];

        if (schedule.totalAmount == 0) revert ScheduleNotFound(scheduleId);
        if (!schedule.revocable) revert ScheduleNotRevocable(scheduleId);
        if (schedule.revoked) revert ScheduleRevoked(scheduleId);

        schedule.revoked = true;

        // Recalculate total — safe subtraction
        uint256 unreleased = schedule.totalAmount - schedule.releasedAmount;
        totalVestingAmount -= unreleased;

        emit Revoked(scheduleId);
    }
}
