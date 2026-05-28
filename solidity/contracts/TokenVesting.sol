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

    // FIXED: Prevent overflow by using per-second rate for large allocations
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // Check for potential overflow before multiplication
        if (duration > 0 && totalAllocation > type(uint256).max / elapsed) {
            // Use per-second rate to avoid overflow
            uint256 perSecond = totalAllocation / duration;
            return perSecond * elapsed;
        }
        return totalAllocation * elapsed / duration;
    }

    function claimable() public view returns (uint256) {
        uint256 vested = vestedAmount();
        if (claimed >= vested) return 0;
        return vested - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    // FIXED: Correct unvested calculation accounting for claimed amount
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // Unvested = total - claimed (not total - vested)
        // If beneficiary already claimed more than vested, nothing to return
        uint256 unvested = totalAllocation > claimed ? totalAllocation - claimed : 0;

        // Return any over-claimed amount back to owner first
        if (claimed > vested) {
            // Beneficiary claimed more than vested, return excess to owner
            token.transfer(owner, claimed - vested);
        } else if (vested > claimed) {
            // Return remaining vested tokens to beneficiary
            token.transfer(beneficiary, vested - claimed);
        }

        if (unvested > claimed) {
            token.transfer(owner, unvested - (claimed > vested ? claimed - vested : 0));
        }

        emit VestingRevoked(beneficiary, unvested);
    }
}
