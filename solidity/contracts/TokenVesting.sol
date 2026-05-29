pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
        uint256 cliffEndTime = start + cliffDuration;
        uint256 elapsed = block.timestamp - start;

        // Calculate vested amount using division before multiplication to prevent overflow
        // Using the formula: totalAllocation / duration * elapsed
        // This prevents intermediate overflow for large allocations
        if (block.timestamp >= cliffEndTime) {
            if (duration > 0) {
                uint250 unvested = totalAllocation - vested;
                // Calculate with proper overflow protection
                uint256 fullPeriods = (totalAllocation / duration) * elapsed;
                uint256 remainder = (totalAllocation % duration) * elapsed / duration;
                vested = fullPeriods + remainder;
            }
        }
    }

    function release() public {
        require(msg.sender == owner, "Only owner can release");
        
        // Calculate releasable amount with safe math
        uint256 elapsed = block.timestamp - start;
        uint256 fullPeriods = (totalAllocation / duration) * elapsed;
        uint256 remainder = ((totalAllocation % duration) * elapsed) / duration;
        uint256 releasable = fullPeriods + remainder;
        IERC20(token).safeTransfer(beneficiary, releasable);
    }

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
}
        if (revoked) {
            return;
        }
        uint256 unreleased = totalAllocation - released;
        if (unreleased > 0) {
            IERC20(token).safeTransfer(beneficiary, releasable);
        }
