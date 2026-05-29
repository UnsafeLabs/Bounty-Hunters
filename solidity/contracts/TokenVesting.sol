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
// TokenVesting.sol
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/SafeMath.sol";

contract TokenVesting {
    using SafeMath for uint256;

    struct VestingSchedule {
        bool initialized;
        uint256 totalAllocation;
        uint256 start;
        uint256 duration;
        uint256 cliff;
        uint256 claimed;
        bool revocable;
    }

    mapping(address => VestingSchedule) private vestingSchedules;
    mapping(address => uint256) private _balances;
    address private _token;
    
    constructor(address token) {
        _token = token;
    }

    function createVestingSchedule(
        address beneficiary,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 totalAllocation,
        bool revocable
    ) public {
        vestingSchedules[beneficiary] = VestingSchedule({
            initialized: true,
            totalAllocation: totalAllocation,
            start: start,
            duration: duration,
            cliff: cliff,
            claimed: 0,
            revocable: revocable
        });
    }

    function vestedAmount(address beneficiary) public view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        uint256 currentTime = block.timestamp;
        if (currentTime < schedule.start) {
            return 0;
        }
        
        // Fixed calculation to prevent overflow by dividing before multiplying
        uint256 elapsed = currentTime - schedule.start;
        if (elapsed > schedule.duration) {
            elapsed = schedule.duration;
        }
        
        // Original problematic line was: return schedule.totalAllocation * elapsed / schedule.duration;
        // New safe calculation:
        uint256 vested = (schedule.totalAllocation * elapsed) / schedule.duration;
        return vested;
    }

    // Fixed version of the vested amount calculation
    function vestedAmount(address beneficiary) public view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        uint256 currentTime = block.timestamp;
        if (currentTime < schedule.start) {
            return 0;
        }
        
        uint256 elapsed = currentTime - schedule.start;
        if (elapsed > schedule.duration) {
            elapsed = schedule.duration;
        }
        
        // Safe calculation to prevent overflow
        // Calculate: totalAllocation * elapsed / duration
        // Refactored to: (totalAllocation / duration) * elapsed + remainder handling
        uint256 baseVested = (schedule.totalAllocation / schedule.duration) * elapsed;
        uint256 remainder = schedule.totalAllocation % schedule.duration;
        uint256 additionalVested = (remainder * elapsed) / schedule.duration;
        
        return baseVested + additionalVested;
    }

    function revoke(address beneficiary) public {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        // Original calculation was incorrect during cliff period
        // Fixed version should return totalAllocation minus already claimed
        // not totalAllocation minus vested amount
        uint256 totalRevoked = schedule.totalAllocation - schedule.claimed;
        // Return unvested tokens to beneficiary
    }
}
}
