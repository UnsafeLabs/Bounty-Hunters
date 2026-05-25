// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

    IERC20 public token;
 * @title TokenVesting
 */
contract TokenVesting is Ownable {
    using SafeMath for uint256;

    struct VestingSchedule {
        uint256 totalAllocation;
        uint256 start;
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
        if (block.timestamp >= schedule.start + schedule.duration) {
            return schedule.totalAllocation - schedule.claimed;
        }
        // Divide before multiply to prevent intermediate overflow
        uint256 elapsed = block.timestamp - schedule.start;
        uint256 quotient = schedule.totalAllocation.div(schedule.duration);
        uint256 remainder = schedule.totalAllocation.mod(schedule.duration);
        uint256 vested = quotient.mul(elapsed);
        // Handle remainder to avoid losing tokens due to integer truncation
        // remainder/duration < 1, so remainder * elapsed / duration gives additional vested tokens
        uint256 remainderVested = remainder.mul(elapsed).div(schedule.duration);
        vested = vested.add(remainderVested);
        return vested - schedule.claimed;
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
}
        require(schedule.revokable, "Not revokable");
        uint256 unvested;
        if (block.timestamp < schedule.start + schedule.cliff) {
            // During cliff period, nothing is vested, so all unclaimed tokens are unvested
            unvested = schedule.totalAllocation.sub(schedule.claimed);
        } else if (block.timestamp >= schedule.start + schedule.duration) {
            // After full vesting, everything is vested, so nothing is unvested
            // (unless some was already claimed)
            unvested = 0;
        } else {
            uint256 vested = vestedAmount(beneficiary);
            unvested = schedule.totalAllocation - schedule.claimed - vested;
