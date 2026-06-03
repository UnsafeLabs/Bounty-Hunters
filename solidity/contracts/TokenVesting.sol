// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TokenVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public token;
    address public beneficiary;
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
    ) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token");
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_totalAllocation > 0, "Invalid allocation");
        require(_cliffDuration <= _vestingDuration, "Cliff > duration");
        
        token = IERC20(_token);
        beneficiary = _beneficiary;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        
        // Divide-before-multiply to prevent overflow
        uint256 basePerSecond = totalAllocation / duration;
        uint256 remainder = totalAllocation % duration;
        
        return basePerSecond * elapsed + (remainder * elapsed / duration);
    }

    function claim() external nonReentrant {
        require(!revoked, "Vesting revoked");
        require(block.timestamp >= cliff, "Before cliff");
        
        uint256 vested = vestedAmount();
        uint256 claimable = vested - claimed;
        require(claimable > 0, "Nothing to claim");
        
        claimed = vested;
        token.safeTransfer(beneficiary, claimable);
        emit TokensClaimed(beneficiary, claimable);
    }

    function revoke() external onlyOwner nonReentrant {
        require(!revoked, "Already revoked");
        
        uint256 vested = vestedAmount();
        uint256 claimable = vested - claimed;
        uint256 unvested = totalAllocation - vested;
        
        revoked = true;
        
        if (claimable > 0) {
            claimed = vested;
            token.safeTransfer(beneficiary, claimable);
            emit TokensClaimed(beneficiary, claimable);
        }
        
        if (unvested > 0) {
            token.safeTransfer(owner(), unvested);
            emit VestingRevoked(beneficiary, unvested);
        }
    }
}
