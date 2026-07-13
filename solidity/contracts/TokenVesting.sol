// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TokenVesting {
    IERC20 public token;
    address public beneficiary;
    address public owner;

    uint256 public start;
    uint256 public cliff;
    uint256 public duration;
    uint256 public totalAllocation;
    uint256 public released;
    uint256 public vestedAtRevocation;

    bool public revoked;

    event TokensReleased(uint256 amount);
    event VestingRevoked(uint256 unvestedAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(
        address _token,
        address _beneficiary,
        uint256 _start,
        uint256 _cliffDuration,
        uint256 _duration,
        uint256 _totalAllocation
    ) {
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_duration > 0, "Duration must be > 0");
        require(_cliffDuration <= _duration, "Cliff longer than duration");

        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _duration;
        totalAllocation = _totalAllocation;
    }

    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) {
            return 0;
        }
        if (revoked) {
            return vestedAtRevocation;
        }
        if (block.timestamp >= start + duration) {
            return totalAllocation;
        }

        uint256 elapsed = block.timestamp - start;

        // Overflow-safe linear vesting: divide first, then handle remainder separately.
        uint256 vestedBase = (totalAllocation / duration) * elapsed;
        uint256 vestedRemainder = (totalAllocation % duration) * elapsed / duration;
        return vestedBase + vestedRemainder;
    }

    function releasableAmount() public view returns (uint256) {
        return vestedAmount() - released;
    }

    function release() external {
        uint256 unreleased = releasableAmount();
        require(unreleased > 0, "No tokens to release");

        released += unreleased;
        token.transfer(beneficiary, unreleased);

        emit TokensReleased(unreleased);
    }

    function revoke() external onlyOwner {
        require(!revoked, "Already revoked");

        uint256 vested = vestedAmount();
        uint256 unvested;
        if (block.timestamp < cliff) {
            unvested = totalAllocation - released;
        } else {
            unvested = totalAllocation - vested;
        }

        vestedAtRevocation = vested;
        revoked = true;
        token.transfer(owner, unvested);

        emit VestingRevoked(unvested);
    }

    function getVestingInfo() external view returns (
        uint256 _start,
        uint256 _cliff,
        uint256 _duration,
        uint256 _totalAllocation,
        uint256 _released,
        uint256 _vested
    ) {
        return (start, cliff, duration, totalAllocation, released, vestedAmount());
    }
}
