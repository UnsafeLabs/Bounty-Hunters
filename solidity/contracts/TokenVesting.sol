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
        require(_token != address(0), "Invalid token");
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_totalAllocation > 0, "Allocation must be > 0");
        require(_vestingDuration > 0, "Duration must be > 0");
        require(_cliffDuration <= _vestingDuration, "Cliff > duration");
        
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
        
        // Prevent overflow: divide before multiply, handle remainder
        // vested = (totalAllocation / duration) * elapsed + (totalAllocation % duration * elapsed / duration)
        uint256 baseVested = (totalAllocation / duration) * elapsed;
        uint256 remainderVested = (totalAllocation % duration * elapsed) / duration;
        
        return baseVested + remainderVested;
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

    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        uint256 unclaimed_vested = vested > claimed ? vested - claimed : 0;
        uint256 unvested = totalAllocation - vested;

        // Transfer remaining vested tokens to beneficiary
        if (unclaimed_vested > 0) {
            claimed += unclaimed_vested;
            token.transfer(beneficiary, unclaimed_vested);
        }
        
        // Transfer unvested tokens back to owner
        if (unvested > 0) {
            token.transfer(owner, unvested);
        }
        
        emit VestingRevoked(beneficiary, unvested);
    }
}
