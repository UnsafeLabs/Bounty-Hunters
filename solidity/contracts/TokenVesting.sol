// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract TokenVesting {
    using SafeERC20 for IERC20;

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
        require(_totalAllocation > 0, "Invalid allocation");
        require(_vestingDuration > 0, "Invalid duration");
        require(_cliffDuration <= _vestingDuration, "Invalid cliff");

        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    function vestedAmount() public view returns (uint256) {
        return vestedAmountAt(block.timestamp);
    }

    function vestedAmountAt(uint256 timestamp) public view returns (uint256) {
        if (timestamp < cliff) return 0;

        uint256 elapsed = timestamp - start;
        if (elapsed >= duration) return totalAllocation;

        uint256 wholeTokens = (totalAllocation / duration) * elapsed;
        uint256 remainder = totalAllocation % duration;
        return wholeTokens + Math.mulDiv(remainder, elapsed, duration);
    }

    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        require(!revoked, "Revoked");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        token.safeTransfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        uint256 claimableVested = vested > claimed ? vested - claimed : 0;
        uint256 unvested = totalAllocation - claimed - claimableVested;

        claimed += claimableVested;

        if (claimableVested > 0) {
            token.safeTransfer(beneficiary, claimableVested);
        }
        if (unvested > 0) {
            token.safeTransfer(owner, unvested);
        }

        emit VestingRevoked(beneficiary, unvested);
    }
}
