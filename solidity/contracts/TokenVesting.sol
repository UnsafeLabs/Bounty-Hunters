// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TokenVesting {
    IERC20 public token;
    address public beneficiary;
    address public owner;

    uint256 public totalAllocation;
    uint256 public start;
    uint256 public cliff;
    uint256 public duration;
    uint256 public claimed;
    bool public revoked;

    event TokensClaimed(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 unvested);

    constructor(
        address _token,
        address _beneficiary,
        uint256 _totalAllocation,
        uint256 _start,
        uint256 _cliffDuration,
        uint256 _vestingDuration
    ) {
        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    // BUG: Overflow risk for large allocations — totalAllocation * elapsed can exceed uint256
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // This multiplication can overflow for large totalAllocation values
        return totalAllocation * elapsed / duration;
    }

    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    // BUG: Incorrect unvested calculation during cliff period
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // BUG: Should be totalAllocation - claimed, not totalAllocation - vested
        // during cliff, vested is 0 but user may have claimed nothing
        uint256 unvested = totalAllocation - vested;

        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TokenVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct VestingSchedule {
        address beneficiary;
        uint256 start;
        uint256 cliff;
        uint256 duration;
        uint256 totalAllocation;
        uint256 released;
        bool revoked;
    }

    IERC20 public token;
    mapping(address => uint256) public vestingSchedules;
    VestingSchedule[] public schedules;

    event TokensReleased(address beneficiary, uint256 amount);
    event TokensRevoked(address beneficiary, uint256 amount);

    constructor(address _token) {
        token = IERC20(_token);
    }

    function createVestingSchedule(
        address _beneficiary,
        uint256 _start,
        uint256 _cliff,
        uint256 _duration,
        uint256 _totalAllocation
    ) external {
        require(_beneficiary != address(0), "Beneficiary is zero address");
        require(_cliff >= _start, "Cliff before start");
        require(_duration > 0, "Duration is 0");
        require(_totalAllocation > 0, "Allocation is 0");

        schedules.push(VestingSchedule({
            beneficiary: _beneficiary,
            start: _start,
            cliff: _cliff,
            duration: _duration,
            totalAllocation: _totalAllocation,
            released: 0,
            revoked: false
        }));

        vestingSchedules[_beneficiary] = schedules.length - 1;
    }

    function vestedAmount(uint256 scheduleIndex) public view returns (uint256) {
        VestingSchedule storage schedule = schedules[scheduleIndex];
        
        if (block.timestamp < schedule.cliff) {
            return 0;
        }

        if (block.timestamp >= schedule.start + schedule.duration || schedule.revoked) {
            return schedule.totalAllocation - schedule.released;
        }

        // Fix: Calculate vested amount with division before multiplication to prevent overflow
        uint256 elapsed = block.timestamp - schedule.start;
        
        // Use division before multiplication to prevent overflow
        uint256 vestedPerUnit = elapsed / schedule.duration;
        uint256 vestedAmount = vestedPerUnit * schedule.totalAllocation;
        
        // Handle remainder for precision
        uint256 remainder = elapsed % schedule.duration;
        if (remainder > 0 && schedule.totalAllocation > 0) {
            uint256 additionalVested = (remainder * schedule.totalAllocation) / schedule.duration;
            vestedAmount += additionalVested;
        }

        return vestedAmount - schedule.released;
    }

    function release(uint256 scheduleIndex) external nonReentrant {
        VestingSchedule storage schedule = schedules[scheduleIndex];
        require(schedule.beneficiary == msg.sender || msg.sender == address(this), "Unauthorized");
        require(!schedule.revoked, "Schedule revoked");

        uint256 amount = vestedAmount(scheduleIndex);
        require(amount > 0, "No tokens vested");

        schedule.released += amount;
        token.safeTransfer(schedule.beneficiary, amount);

        emit TokensReleased(schedule.beneficiary, amount);
    }

    function revoke(uint256 scheduleIndex) external nonReentrant {
        VestingSchedule storage schedule = schedules[scheduleIndex];
        require(!schedule.revoked, "Schedule already revoked");

        uint256 unreleased = schedule.totalAllocation - schedule.released;
        uint256 refundAmount;

        // Fix: During cliff period, return full allocation minus claimed, not minus vested
        if (block.timestamp < schedule.cliff) {
            refundAmount = unreleased;
        } else {
            // After cliff, return only unvested tokens
            uint256 vested = schedule.totalAllocation - unreleased;
            refundAmount = schedule.totalAllocation - vested - schedule.released;
        }

        schedule.revoked = true;
        token.safeTransfer(msg.sender, refundAmount);

        emit TokensRevoked(schedule.beneficiary, refundAmount);
    }
}
}
