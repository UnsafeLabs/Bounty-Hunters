// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TokenVesting - Linear token vesting with cliff period
/// @notice Fixed: Integer overflow prevention for large allocations via divide-before-multiply
/// @notice Fixed: Correct unvested calculation during cliff-period revocation
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
        require(_token != address(0), "Invalid token");
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_totalAllocation > 0, "Zero allocation");
        require(_vestingDuration > 0, "Zero duration");
        require(_cliffDuration <= _vestingDuration, "Cliff > duration");

        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    /// @notice Calculates the total amount of tokens vested so far
    /// @dev Uses divide-before-multiply to prevent overflow for large allocations.
    ///      Remainder is preserved: (totalAllocation % duration) * elapsed / duration
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;

        // Divide before multiply to avoid overflow: totalAllocation * elapsed can
        // exceed uint256 for allocations >= 1 billion tokens (1e27) with 18 decimals.
        // Preserves accuracy via remainder term.
        uint256 base = (totalAllocation / duration) * elapsed;
        uint256 remainder = ((totalAllocation % duration) * elapsed) / duration;
        return base + remainder;
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

    /// @notice Revoke the vesting schedule and return unvested tokens to owner
    /// @dev Fixes the cliff-period revocation bug:
    ///      - Vested but unclaimed tokens are sent to the beneficiary
    ///      - Unvested tokens (totalAllocation - vested) are returned to the owner
    ///      - During cliff, vested = 0 so all tokens return to owner (correct behavior)
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        uint256 unvested = totalAllocation - vested;

        // Transfer any vested-but-unclaimed tokens to beneficiary
        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        // Return unvested tokens to owner
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
