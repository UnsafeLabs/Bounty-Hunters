// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

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
        require(_vestingDuration > 0, "Invalid duration");
        require(_cliffDuration <= _vestingDuration, "Invalid cliff");
        require(_start <= type(uint256).max - _cliffDuration, "Invalid cliff");

        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    function vestedAmount() public view returns (uint256) {
        return _vestedAmount(block.timestamp);
    }

    function _vestedAmount(uint256 timestamp) internal view returns (uint256) {
        if (timestamp < cliff) return 0;

        uint256 elapsed = timestamp - start;
        if (elapsed >= duration) return totalAllocation;

        uint256 vested = (totalAllocation / duration) * elapsed;
        uint256 remainder = totalAllocation % duration;
        if (remainder > 0) {
            vested += Math.mulDiv(remainder, elapsed, duration);
        }
        return vested;
    }

    function claimable() public view returns (uint256) {
        uint256 vested = vestedAmount();
        if (vested <= claimed) return 0;
        return vested - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        require(!revoked, "Vesting revoked");
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
        uint256 claimableAmount = vested > claimed ? vested - claimed : 0;
        uint256 unvested = totalAllocation - claimed - claimableAmount;

        if (claimableAmount > 0) {
            token.transfer(beneficiary, claimableAmount);
        }
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
