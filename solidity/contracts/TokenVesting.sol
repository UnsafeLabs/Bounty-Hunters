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

    // Fixed: Divide before multiply to prevent overflow
    // Fixed: Remainder handling ensures total equals totalAllocation at vesting end
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // Safe calculation: divide first to avoid overflow
        uint256 perSecond = totalAllocation / duration;
        uint256 remainder = totalAllocation % duration;

        // Distribute the remainder across the period
        uint256 result = perSecond * elapsed;
        // Add proportional remainder: the remainder gets distributed evenly
        // over the duration, so add (remainder * elapsed / duration) to the result
        result += remainder * elapsed / duration;

        return result;
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

    // Fixed: Correct unvested calculation - uses totalAllocation - claimed
    // During cliff period, vested is 0 but unvested should be totalAllocation - claimed
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();

        // Fixed: unvested = totalAllocation - claimed (not totalAllocation - vested)
        uint256 unvested = totalAllocation - claimed;

        // If there are vested but unclaimed tokens, send them to beneficiary
        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        // Return unvested tokens to owner
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
