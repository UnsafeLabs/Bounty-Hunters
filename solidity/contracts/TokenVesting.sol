// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

    IERC20 public token;
    address public beneficiary;
    address public owner;
 * @dev A token vesting contract that releases tokens linearly over time.
 */
contract TokenVesting is Ownable {
    using SafeMath for uint256;

    IERC20 public token;
    
    struct VestingSchedule {
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
        }
        
        uint256 elapsed = block.timestamp - schedule.start;
        
        // Divide before multiply to prevent intermediate overflow
        // Handle remainder to avoid losing tokens due to integer truncation
        uint256 allocationPerDuration = schedule.totalAllocation / schedule.duration;
        uint256 remainder = schedule.totalAllocation % schedule.duration;
        
        uint256 vested = allocationPerDuration.mul(elapsed);
        
        // Add proportional remainder to maintain accuracy
        vested = vested.add(remainder.mul(elapsed).div(schedule.duration));
        
        if (vested > schedule.totalAllocation) {
            vested = schedule.totalAllocation;

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
        require(!schedule.revoked, "Vesting already revoked");
        
        uint256 vestedAmount = vestedAmount(beneficiary);
        
        // During cliff period, vestedAmount is 0, so unvested should be totalAllocation minus already claimed
        uint256 unvested = schedule.totalAllocation.sub(vestedAmount);
        
        // Subtract already claimed tokens to get truly unvested tokens
        unvested = unvested.sub(schedule.claimed);
        
        schedule.revoked = true;
        
        
        // Return unvested tokens to owner
        if (unvested > 0) {
            require(token.transfer(owner(), unvested), "Token transfer failed");
        }
        
        emit VestingRevoked(beneficiary, unvested);
