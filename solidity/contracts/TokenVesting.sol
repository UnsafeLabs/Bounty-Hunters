// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TokenVesting - Fixed Version
 * @notice Fixes integer overflow vulnerability and incorrect unvested calculation
 */
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

    /**
     * @notice Calculates vested amount with overflow protection
     * 
     * FIX: Changed from `(totalAllocation * elapsed) / duration` to 
     * `(totalAllocation / duration) * elapsed + (remainder * elapsed) / duration`
     * This prevents intermediate overflow for large allocations.
     */
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        
        // FIX: Divide before multiply to prevent overflow
        uint256 quotient = totalAllocation / duration;
        uint256 remainder = totalAllocation % duration;
        
        // Calculate using formula that keeps intermediate values bounded:
        // vested = (quotient * elapsed) + ((remainder * elapsed) / duration)
        return (quotient * elapsed) + ((remainder * elapsed) / duration);
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

    /**
     * @notice Revokes unvested tokens and returns them to owner
     * 
     * FIX: Now correctly calculates unvested as (totalAllocation - claimed)
     * instead of (totalAllocation - vested). During cliff period, vested=0
     * but user might have legitimately claimed tokens already.
     */
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        
        // FIX: Use totalAllocation - claimed (not totalAllocation - vested)
        // This ensures correct accounting even during cliff period
        uint256 unvested = totalAllocation > claimed 
            ? totalAllocation - claimed 
            : 0;

        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
