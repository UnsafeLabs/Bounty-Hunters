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
        uint256 totalAllocation;
        uint256 start;
        uint256 cliff;
        uint256 duration;
        uint256 released;
        bool revoked;
    }

    address public owner;
    IERC20 public token;
    mapping(address => VestingSchedule) public schedules;

    event TokensReleased(address indexed beneficiary, uint256 amount);
    event TokensRevoked(address indexed beneficiary, uint256 refund);

    constructor(address _token) {
        owner = msg.sender;
        token = IERC20(_token);
    }

    function createVestingSchedule(
        address _beneficiary,
        uint256 _totalAllocation,
        uint256 _start,
        uint256 _cliff,
        uint256 _duration
    ) external onlyOwner {
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_totalAllocation > 0, "Allocation must be > 0");
        require(_duration > 0, "Duration must be > 0");
        require(_cliff >= _start, "Cliff must be >= start");
        require(_duration >= _cliff - _start, "Duration must be >= cliff");

        schedules[_beneficiary] = VestingSchedule({
            totalAllocation: _totalAllocation,
            start: _start,
            cliff: _cliff,
            duration: _duration,
            released: 0,
            revoked: false
        });
    }

    function vestedAmount(address _beneficiary) public view returns (uint256) {
        VestingSchedule storage schedule = schedules[_beneficiary];
        if (schedule.revoked) {
            return 0;
        }

        uint256 current = block.timestamp;

        if (current < schedule.cliff) {
            return 0;
        }

        if (current >= schedule.start + schedule.duration) {
            return schedule.totalAllocation - schedule.released;
        } else {
            // Fix: Calculate vested amount without overflow
            // Instead of: schedule.totalAllocation * (current - schedule.start) / schedule.duration
            // Use: (schedule.totalAllocation / schedule.duration) * (current - schedule.start) + remainder
            uint256 elapsed = current - schedule.start;
            uint256 vestedPerSecond = schedule.totalAllocation / schedule.duration;
            uint256 vested = vestedPerSecond * elapsed;
            
            // Handle remainder to avoid losing tokens
            uint256 remainder = (schedule.totalAllocation % schedule.duration) * elapsed / schedule.duration;
            vested += remainder;
            
            return vested;
        }
    }

    function release(address _beneficiary) external nonReentrant {
        VestingSchedule storage schedule = schedules[_beneficiary];
        require(!schedule.revoked, "Schedule revoked");
        
        uint256 amount = vestedAmount(_beneficiary);
        require(amount > 0, "No tokens vested");

        schedule.released += amount;
        token.safeTransfer(_beneficiary, amount);

        emit TokensReleased(_beneficiary, amount);
    }

    function revoke(address _beneficiary) external onlyOwner nonReentrant {
        VestingSchedule storage schedule = schedules[_beneficiary];
        require(!schedule.revoked, "Schedule already revoked");
        
        uint256 vested = vestedAmount(_beneficiary);
        uint256 refund;
        
        // Fix: During cliff period, return totalAllocation minus already claimed, not total minus vested
        if (block.timestamp < schedule.cliff) {
            // Before cliff - return all unclaimed tokens
            refund = schedule.totalAllocation - schedule.released;
        } else {
            // After cliff - return only unvested tokens
            uint256 totalVested = vested;
            refund = schedule.totalAllocation - schedule.released - totalVested;
        }

        schedule.revoked = true;
        token.safeTransfer(owner, refund);

        emit TokensRevoked(_beneficiary, refund);
    }

    function releasable(address _beneficiary) external view returns (uint256) {
        return vestedAmount(_beneficiary);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
}
}
