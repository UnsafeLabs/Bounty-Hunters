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

    /// @dev Divide-before-multiply with explicit remainder handling to prevent overflow
    ///      while maintaining precision. Split into (totalAllocation/duration)*elapsed
    ///      plus remainder*elapsed/duration.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // Divide before multiply: prevents overflow for large allocations
        uint256 baseAmount = (totalAllocation / duration) * elapsed;
        // Handle remainder to avoid truncation loss
        uint256 remainder = totalAllocation % duration;
        uint256 remainderPortion = (remainder * elapsed) / duration;
        return baseAmount + remainderPortion;
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

    /// @dev Fixed: unvested = totalAllocation - claimed - unclaimed_vested
    ///      During cliff, vested=0 so all tokens go back to owner.
    ///      After partial vesting, beneficiary gets their vested portion, owner gets the rest.
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
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
