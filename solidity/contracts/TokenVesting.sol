// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TokenVesting {
    address public owner;
    address public token;
    uint256 public totalAllocated;

    struct VestingSchedule {
        uint256 totalAmount;
        uint256 released;
        uint256 start;
        uint256 cliff;
        uint256 duration;
        uint256 revoked;
    }

    mapping(address => VestingSchedule) public schedules;

    event Vested(address indexed beneficiary, uint256 amount, uint256 start, uint256 cliff, uint256 duration);
    event Released(address indexed beneficiary, uint256 amount);
    event Revoked(address indexed beneficiary, uint256 remaining);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonZeroAddress(address _addr) {
        require(_addr != address(0), "Zero address not allowed");
        _;
    }

    constructor(address _token) nonZeroAddress(_token) {
        owner = msg.sender;
        token = _token;
    }

    function vest(
        address beneficiary,
        uint256 totalAmount,
        uint256 start,
        uint256 cliff,
        uint256 duration
    )
        public
        onlyOwner
        nonZeroAddress(beneficiary)
    {
        require(schedules[beneficiary].totalAmount == 0, "Already vested");
        require(totalAmount > 0, "Amount must be > 0");
        require(start >= block.timestamp, "Start must be in future");
        require(cliff > 0, "Cliff must be > 0");
        require(duration > 0, "Duration must be > 0");

        // Overflow check: totalAllocated + totalAmount
        require(type(uint256).max - totalAllocated >= totalAmount, "Overflow: total allocated");

        totalAllocated += totalAmount;
        schedules[beneficiary] = VestingSchedule({
            totalAmount: totalAmount,
            released: 0,
            start: start,
            cliff: cliff,
            duration: duration,
            revoked: 0
        });

        emit Vested(beneficiary, totalAmount, start, cliff, duration);
    }

    function release() public {
        VestingSchedule storage schedule = schedules[msg.sender];
        require(schedule.totalAmount > 0, "No vesting schedule");
        require(schedule.revoked == 0, "Schedule revoked");

        uint256 available = _available(msg.sender);
        require(available > 0, "Nothing to release");

        uint256 newReleased = schedule.released + available;
        require(newReleased >= schedule.released, "Overflow: released"); // safety check
        schedule.released = newReleased;

        IERC20(token).transfer(msg.sender, available);
        emit Released(msg.sender, available);
    }

    function revoke(address beneficiary) public onlyOwner {
        VestingSchedule storage schedule = schedules[beneficiary];
        require(schedule.totalAmount > 0, "No vesting schedule");
        require(schedule.revoked == 0, "Already revoked");

        uint256 released = schedule.released;
        uint256 remaining = schedule.totalAmount - released;

        schedule.revoked = remaining;

        if (remaining > 0) {
            totalAllocated -= remaining;
            IERC20(token).transfer(owner, remaining);
        }

        emit Revoked(beneficiary, remaining);
    }

    function _available(address beneficiary) internal view returns (uint256) {
        VestingSchedule storage schedule = schedules[beneficiary];

        if (schedule.revoked > 0 || schedule.totalAmount == 0) {
            return 0;
        }

        uint256 total = schedule.totalAmount;

        // Overflow-safe multiplication: use uint256 cast
        uint256 elapsed = block.timestamp - schedule.start;
        if (elapsed < schedule.cliff) {
            return 0;
        }
        if (elapsed >= schedule.duration) {
            return total - schedule.released;
        }

        // Use SafeMath pattern: elapsed * total / duration
        uint256 vested = (elapsed * total) / schedule.duration;
        if (vested <= schedule.released) {
            return 0;
        }
        return vested - schedule.released;
    }

    function available(address beneficiary) public view returns (uint256) {
        return _available(beneficiary);
    }
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}
