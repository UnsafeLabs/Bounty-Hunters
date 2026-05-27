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

    /// @notice Calculates the vested amount using divide-before-multiply
    ///         to prevent intermediate overflow for large allocations.
    ///         Handles remainder to ensure accuracy within 1 token unit.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;

        // Divide before multiply to prevent overflow:
        // totalAllocation / duration * elapsed + remainder
        uint256 vested = (totalAllocation / duration) * elapsed;

        // Handle remainder: (totalAllocation % duration) * elapsed / duration
        // This ensures total claimed equals totalAllocation at vesting end
        uint256 remainder = totalAllocation % duration;
        if (remainder > 0) {
            vested += (remainder * elapsed) / duration;
        }

        return vested;
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

    /// @notice Revokes vesting. Returns unvested tokens to the owner.
    ///         During cliff period, unvested = totalAllocation - claimed
    ///         (not totalAllocation - vested, since vested is 0 but
    ///         nothing has been claimed).
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // Fix: unvested is totalAllocation minus what has already been claimed
        // or vested (whichever is larger), ensuring correct accounting during
        // cliff period when vested is 0 but user hasn't claimed anything.
        uint256 unvested = totalAllocation - claimed - (vested > claimed ? vested - claimed : 0);

        // Transfer any vested-but-unclaimed tokens to beneficiary
        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        // Transfer unvested tokens back to owner
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
