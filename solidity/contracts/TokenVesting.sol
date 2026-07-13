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

    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // Safe calculation: divide before multiply to prevent intermediate overflow
        // vested = floor(totalAllocation * elapsed / duration)
        // Decompose: totalAllocation = q * duration + r, where q = totalAllocation/duration, r = totalAllocation%duration
        // Then: (q * duration + r) * elapsed / duration = q * elapsed + (r * elapsed) / duration
        uint256 q = totalAllocation / duration;
        uint256 r = totalAllocation % duration;
        return q * elapsed + (r * elapsed) / duration;
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

    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // Truly unvested = totalAllocation - vestedAmount (not totalAllocation - claimed)
        // During cliff: vested=0, so unvested=totalAllocation (correct)
        // After partial vesting: unvested = totalAllocation - vested (only truly unvested tokens)
        uint256 unvested = totalAllocation - vested;

        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        if (unvested > 0) {
            token.transfer(owner, unvested);
        }
        emit VestingRevoked(beneficiary, unvested);
    }
}
