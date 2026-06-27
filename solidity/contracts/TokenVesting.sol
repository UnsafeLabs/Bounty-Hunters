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

    // FIX: Divide before multiply to prevent intermediate overflow
    // totalAllocation / duration * elapsed avoids the overflow that
    // totalAllocation * elapsed / duration can cause for large allocations
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // FIX: Divide first to prevent overflow, then multiply
        // This avoids the intermediate value totalAllocation * elapsed exceeding uint256
        uint256 vested = (totalAllocation / duration) * elapsed;
        // Handle remainder to avoid losing tokens due to truncation
        uint256 remainder = (totalAllocation % duration) * elapsed / duration;
        return vested + remainder;
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

    // FIX: Correct unvested calculation — should be totalAllocation - claimed, not totalAllocation - vested
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // FIX: unvested = totalAllocation - claimed (what's left that hasn't been claimed)
        // During cliff period, vested is 0 but claimed may also be 0, so unvested = totalAllocation
        uint256 unvested = totalAllocation - claimed;

        // Transfer any vested but unclaimed tokens to beneficiary
        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        // Transfer unvested tokens back to owner
        // unvested already accounts for claimed tokens, subtract the vested-claimed portion
        token.transfer(owner, unvested - (vested > claimed ? vested - claimed : 0));
        emit VestingRevoked(beneficiary, unvested);
    }
}
