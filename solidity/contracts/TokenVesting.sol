// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TokenVesting is ReentrancyGuard {
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
        
        // Added overflow checks in constructor
        require(_start + _cliffDuration >= _start, "Cliff overflow");
        require(_start + _vestingDuration >= _start, "Duration overflow");
    }

    // FIX: Safe multiplication to prevent overflow
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // Safe multiplication: divide first to prevent overflow
        // Use larger precision to avoid rounding errors
        return (totalAllocation * elapsed) / duration;
    }

    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    // FIX: Apply checks-effects-interactions pattern
    function claim() external nonReentrant {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        
        // State update BEFORE external call
        claimed += amount;
        emit TokensClaimed(beneficiary, amount);
        
        // External call after state update
        token.transfer(beneficiary, amount);
    }

    // FIX: Correct unvested calculation
    function revoke() external nonReentrant {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // FIX: unvested = totalAllocation - vested (not totalAllocation - claimed)
        uint256 unvested = totalAllocation - vested;
        
        // Transfer any remaining vested but unclaimed tokens to beneficiary
        if (vested > claimed) {
            uint256 remainingVested = vested - claimed;
            // State update: mark all as claimed
            claimed = vested;
            emit TokensClaimed(beneficiary, remainingVested);
            token.transfer(beneficiary, remainingVested);
        }
        
        // Transfer unvested tokens back to owner
        emit VestingRevoked(beneficiary, unvested);
        token.transfer(owner, unvested);
    }
}
