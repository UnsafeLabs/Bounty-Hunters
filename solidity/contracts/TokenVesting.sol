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

    error NotBeneficiary();
    error NotOwner();
    error NothingToClaim();
    error AlreadyRevoked();

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

    // Fix: Divide before multiply to prevent intermediate overflow
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // Safe calculation: divide first, then handle remainder
        // This prevents overflow when totalAllocation * elapsed exceeds uint256
        return (totalAllocation / duration) * elapsed + (totalAllocation % duration) * elapsed / duration;
    }

    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    function claim() external {
        if (msg.sender != beneficiary) {
            revert NotBeneficiary();
        }
        uint256 amount = claimable();
        if (amount == 0) {
            revert NothingToClaim();
        }
        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    // Fix: Correct unvested calculation — should be totalAllocation - vested
    function revoke() external {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        if (revoked) {
            revert AlreadyRevoked();
        }
        revoked = true;

        uint256 vested = vestedAmount();
        // Unvested = total allocation - what has vested
        uint256 unvested = totalAllocation - vested;

        // Transfer any unclaimed vested tokens to beneficiary
        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        // Return unvested tokens to owner
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
