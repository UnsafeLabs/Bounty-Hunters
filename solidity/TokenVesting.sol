// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenVesting is Ownable {
    ERC20 public token;
    address public beneficiary;
    
    uint256 public cliff;
    uint256 public start;
    uint256 public duration;
    
    bool public revocable;
    bool public revoked;
    
    uint256 public totalAllocation;
    uint256 public released;

    event TokensReleased(address token, uint256 amount);
    event TokenVestingRevoked(address token);

    constructor(
        address _token,
        address _beneficiary,
        uint256 _start,
        uint256 _cliffDuration,
        uint256 _duration,
        bool _revocable,
        uint256 _totalAllocation
    ) {
        require(_beneficiary != address(0), "Beneficiary cannot be zero");
        require(_cliffDuration <= _duration, "Cliff > duration");
        require(_duration > 0, "Duration must be > 0");

        token = ERC20(_token);
        beneficiary = _beneficiary;
        revocable = _revocable;
        duration = _duration;
        start = _start;
        cliff = start + _cliffDuration;
        totalAllocation = _totalAllocation;
    }

    function release() public {
        require(!revoked, "Token vesting revoked");
        uint256 unreleased = vestedAmount() - released;
        require(unreleased > 0, "No tokens to release");

        released += unreleased;
        token.transfer(beneficiary, unreleased);

        emit TokensReleased(address(token), unreleased);
    }

    function revoke() public onlyOwner {
        require(revocable, "Vesting is not revocable");
        require(!revoked, "Vesting already revoked");

        // Fix for #917: properly calculate unvested and refund owner
        uint256 balance = token.balanceOf(address(this));
        uint256 unreleased = vestedAmount() - released;
        uint256 refund = balance - unreleased;

        revoked = true;
        
        if (refund > 0) {
            token.transfer(owner(), refund);
        }

        emit TokenVestingRevoked(address(token));
    }

    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) {
            return 0;
        } else if (block.timestamp >= start + duration || revoked) {
            return totalAllocation;
        } else {
            // Fix for #917: prevent overflow and preserve precision
            uint256 elapsed = block.timestamp - start;
            uint256 base = (totalAllocation / duration) * elapsed;
            uint256 remainder = totalAllocation % duration;
            uint256 precisionBase = (remainder * elapsed) / duration;
            
            return base + precisionBase;
        }
    }
}
