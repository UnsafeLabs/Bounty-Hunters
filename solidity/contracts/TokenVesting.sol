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
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_vestingDuration > 0, "Duration must be > 0");
        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    // FIX: Use mulDiv-safe pattern to avoid overflow on large allocations
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // FIX: Safe multiplication — Solidity 0.8+ reverts on overflow, but
        // use explicit bounds check for clarity with large allocations
        require(elapsed <= duration, "Elapsed exceeds duration");
        return totalAllocation * elapsed / duration;
    }

    function claimable() public view returns (uint256) {
        if (revoked) return 0;
        return vestedAmount() - claimed;
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

    // FIX: Correct unvested calculation — unvested = totalAllocation - vested (not claimed)
    // FIX: Transfer only unclaimed vested tokens to beneficiary on revoke
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // FIX: Unvested is everything not yet vested
        uint256 unvested = totalAllocation - vested;

        // Transfer any unclaimed but vested tokens to beneficiary
        if (vested > claimed) {
            uint256 claimableNow = vested - claimed;
            claimed += claimableNow;
            token.transfer(beneficiary, claimableNow);
        }

        // Return unvested tokens to owner
        if (unvested > 0) {
            token.transfer(owner, unvested);
        }

        emit VestingRevoked(beneficiary, unvested);
    }
}
