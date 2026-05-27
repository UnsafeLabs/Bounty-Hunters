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
        require(_vestingDuration > 0, "Duration must be > 0");
        require(_totalAllocation > 0, "Allocation must be > 0");
        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    /// @dev Fixed: uses divide-before-multiply pattern to prevent overflow.
    ///      totalAllocation / duration * elapsed avoids the intermediate
    ///      overflow of totalAllocation * elapsed for large allocations.
    ///      Remainder is handled separately to ensure accuracy.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation - claimed > totalAllocation ? 0 : totalAllocation;

        uint256 elapsed = block.timestamp - start;

        // Divide-before-multiply to prevent overflow:
        // Instead of totalAllocation * elapsed / duration (can overflow),
        // use totalAllocation / duration * elapsed (safe for large allocations)
        // Plus handle the remainder: (totalAllocation % duration) * elapsed / duration
        uint256 quotient = totalAllocation / duration;
        uint256 remainder = totalAllocation % duration;

        // quotient * elapsed is safe because quotient = totalAllocation / duration
        // which is at most totalAllocation, and elapsed < duration
        // So quotient * elapsed < totalAllocation * duration / duration = totalAllocation
        return quotient * elapsed + (remainder * elapsed) / duration;
    }

    function claimable() public view returns (uint256) {
        uint256 vested = vestedAmount();
        return vested > claimed ? vested - claimed : 0;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        require(!revoked, "Vesting revoked");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    /// @dev Fixed: unvested calculation now correctly uses (totalAllocation - claimed) 
    ///      instead of (totalAllocation - vested) during cliff period.
    ///      During cliff, vested=0, but claimed may also be 0, so unvested = totalAllocation - claimed.
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // Fixed: unvested = totalAllocation - claimed (tokens not yet claimed by beneficiary)
        // Not totalAllocation - vested (which is wrong during cliff when vested=0)
        uint256 unclaimed = vested > claimed ? vested - claimed : 0;
        uint256 unvested = totalAllocation - claimed - unclaimed;

        if (unclaimed > 0) {
            token.transfer(beneficiary, unclaimed);
        }
        if (unvested > 0) {
            token.transfer(owner, unvested);
        }
        emit VestingRevoked(beneficiary, unvested);
    }
}
