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

    // BUG: Overflow risk for large allocations — totalAllocation * elapsed can exceed uint256
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        uint256 base = totalAllocation / duration;
        uint256 remainder = totalAllocation % duration;
        return (base * elapsed) + (remainder * elapsed / duration);
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
        require(token.transfer(beneficiary, amount), "Transfer failed");
        emit TokensClaimed(beneficiary, amount);
    }

    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        uint256 claimableVested = vested > claimed ? vested - claimed : 0;
        uint256 unvested = totalAllocation - claimed - claimableVested;

        if (claimableVested > 0) {
            claimed += claimableVested;
            require(token.transfer(beneficiary, claimableVested), "Transfer failed");
        }
        require(token.transfer(owner, unvested), "Transfer failed");
        emit VestingRevoked(beneficiary, unvested);
    }
}
