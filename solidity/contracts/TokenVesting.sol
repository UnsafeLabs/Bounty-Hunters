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
        require(_vestingDuration > 0, "Duration must be > 0");
        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < start) return 0;
        if (block.timestamp < cliff) return 0;

        uint256 elapsed = block.timestamp - start;
        if (elapsed >= duration) return totalAllocation;

        uint256 vestedWholeUnits = (totalAllocation / duration) * elapsed;
        uint256 vestedRemainder = Math.mulDiv(totalAllocation % duration, elapsed, duration);
        return vestedWholeUnits + vestedRemainder;
    }

    function claimable() public view returns (uint256) {
        if (revoked) return 0;

        uint256 vested = vestedAmount();
        if (vested <= claimed) return 0;
        return vested - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        require(token.transfer(beneficiary, amount), "Transfer failed");
        emit TokensClaimed(beneficiary, amount);
    }

    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 claimableAmount = 0;
        uint256 vested = vestedAmount();
        if (vested > claimed) {
            claimableAmount = vested - claimed;
        }

        uint256 unvested = totalAllocation - claimed - claimableAmount;

        if (claimableAmount > 0) {
            claimed += claimableAmount;
            require(token.transfer(beneficiary, claimableAmount), "Transfer failed");
        }
        require(token.transfer(owner, unvested), "Transfer failed");
        emit VestingRevoked(beneficiary, unvested);
    }
}
