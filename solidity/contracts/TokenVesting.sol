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

    /// @notice Calculate the total vested amount using overflow-safe math
    /// @dev Divides before multiplying to prevent intermediate overflow.
    ///      Uses remainder tracking to ensure no tokens are lost to truncation.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;

        // Overflow-safe: divide first, then multiply
        // totalAllocation / duration * elapsed
        // This prevents overflow when totalAllocation * elapsed > type(uint256).max
        uint256 quotient = totalAllocation / duration;
        uint256 remainder = totalAllocation % duration;

        // Calculate: quotient * elapsed + (remainder * elapsed) / duration
        // The remainder term recovers truncation loss from the division
        // remainder * elapsed can still overflow for very large values,
        // but remainder < duration so remainder * elapsed < duration * elapsed
        // which for reasonable durations (e.g. 4 years = ~126M seconds) and
        // 1B tokens * 18 decimals = 1e27, the max intermediate is:
        // 1e27 * 126e6 = 1.26e35, well within uint256 max (1.15e77)
        return quotient * elapsed + (remainder * elapsed) / duration;
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

    /// @notice Revoke vesting and return unvested tokens to owner
    /// @dev Fixes: unvested is now totalAllocation - claimed (not totalAllocation - vested)
    ///      During cliff period, vested is 0, so unvested = totalAllocation - claimed
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();

        // Fix: unvested = totalAllocation - claimed (everything not yet claimed)
        // not totalAllocation - vested (which incorrectly ignores already-claimed tokens)
        uint256 unvested = totalAllocation - claimed;

        // Transfer vested-but-unclaimed tokens to beneficiary
        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }

        // Transfer all remaining (unvested) tokens to owner
        token.transfer(owner, unvested);

        emit VestingRevoked(beneficiary, unvested);
    }
}
