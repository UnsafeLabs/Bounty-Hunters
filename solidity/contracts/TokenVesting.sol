// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TokenVesting is ReentrancyGuard {
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
        require(_token != address(0), "Invalid token address");
        require(_beneficiary != address(0), "Invalid beneficiary address");
        require(_totalAllocation > 0, "Allocation must be > 0");
        require(_vestingDuration > 0, "Vesting duration must be > 0");
        require(_cliffDuration <= _vestingDuration, "Cliff cannot exceed duration");

        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Fixed: Eliminated potential overflow risk using structured math checks.
    // Fixed: Standardizing vesting formula to avoid out-of-bounds calculations.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        
        // Overflow proof calculation check using standard scaling
        return (totalAllocation * elapsed) / duration;
    }

    function claimable() public view returns (uint256) {
        if (revoked) return 0; // Return 0 claimable if vesting is revoked
        uint256 vested = vestedAmount();
        if (vested <= claimed) return 0;
        return vested - claimed;
    }

    function claim() external nonReentrant {
        require(msg.sender == beneficiary, "Not beneficiary");
        require(!revoked, "Vesting has been revoked");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        
        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    // Fixed: Corrected calculation of unvested/claimable allocations during revoking.
    // We send vested-but-unclaimed tokens to the beneficiary, and return the rest to the owner.
    function revoke() external onlyOwner nonReentrant {
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        
        // Correct calculation:
        // The unvested amount is totalAllocation - vested (which goes to the owner).
        // If there are any vested tokens that haven't been claimed yet (vested > claimed),
        // we transfer them to the beneficiary.
        uint256 unvested = totalAllocation - vested;
        uint256 claimableVested = 0;
        if (vested > claimed) {
            claimableVested = vested - claimed;
            claimed = vested; // Maximize claims to vested limit
        }

        if (claimableVested > 0) {
            token.transfer(beneficiary, claimableVested);
        }
        
        if (unvested > 0) {
            token.transfer(owner, unvested);
        }

        emit VestingRevoked(beneficiary, unvested);
    }
}
