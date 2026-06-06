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
        require(_vestingDuration > 0, "Invalid duration");
        require(_cliffDuration <= _vestingDuration, "Invalid cliff");
        require(_beneficiary != address(0), "Invalid beneficiary");
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;

        uint256 elapsed = block.timestamp - start;
        if (elapsed >= duration) return totalAllocation;

        uint256 whole = (totalAllocation / duration) * elapsed;
        uint256 remainder = (totalAllocation % duration) * elapsed / duration;
        return whole + remainder;
    }

    function claimable() public view returns (uint256) {
        if (revoked) return 0;
        return vestedAmount() - claimed;
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

        uint256 vested = vestedAmount();
        uint256 payableVested = vested > claimed ? vested - claimed : 0;
        uint256 unvested = totalAllocation - claimed - payableVested;

        if (payableVested > 0) {
            claimed += payableVested;
            require(token.transfer(beneficiary, payableVested), "Transfer failed");
        }
        require(token.transfer(owner, unvested), "Transfer failed");
        emit VestingRevoked(beneficiary, unvested);
    }
}
