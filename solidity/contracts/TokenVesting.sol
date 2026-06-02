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

    /// @notice Returns the amount of tokens currently vested.
    /// @dev Uses divide-before-multiply pattern to prevent intermediate overflow.
    ///      totalAllocation * elapsed can exceed uint256 for large allocations +
    ///      long durations. We compute `totalAllocation / duration` first, then
    ///      multiply by elapsed, and add the remainder term to avoid truncation.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;

        // Divide first: mainTerm = (totalAllocation / duration) * elapsed
        uint256 basePerSecond = totalAllocation / duration;
        uint256 mainTerm = basePerSecond * elapsed;

        // Remainder compensation: the leftover seconds' worth accumulated
        // across the elapsed period.
        uint256 remainder = totalAllocation % duration;
        uint256 remainderTerm;
        unchecked {
            // remainder < duration, elapsed <= duration, so product fits in uint256
            remainderTerm = remainder * elapsed / duration;
        }

        return mainTerm + remainderTerm;
    }

    function claimable() public view returns (uint256) {
        uint256 vested = vestedAmount();
        if (vested <= claimed) return 0;
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

    /// @notice Revoke vesting and return unvested tokens to the owner.
    /// @dev Unvested amount = totalAllocation - claimed (not totalAllocation - vested).
    ///      During cliff, vested is 0 but beneficiary may have claimed nothing —
    ///      using vested would incorrectly send all tokens back as "unvested".
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();

        // Correct: unvested = tokens not yet claimed, not tokens not yet vested.
        uint256 unvested = totalAllocation - claimed;

        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
