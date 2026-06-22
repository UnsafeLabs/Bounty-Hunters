// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
        require(_vestingDuration > 0, "Duration must be > 0");
        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    /// @notice Returns the amount vested as of the current block timestamp
    /// @dev Uses divide-before-multiply pattern to prevent overflow for large allocations
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;

        // Divide first to prevent intermediate overflow
        uint256 baseVested = totalAllocation / duration * elapsed;
        uint256 remainder = totalAllocation % duration;
        uint256 remainderVested = (remainder * elapsed) / duration;

        return baseVested + remainderVested;
    }

    /// @notice Returns the currently claimable amount
    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    /// @notice Claims available vested tokens
    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        token.safeTransfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    /// @notice Revokes the vesting schedule, returning unvested tokens to owner
    /// @dev unvested = totalAllocation - vested (correct during cliff where vested=0)
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // Unvested is what hasn't vested yet (works during cliff: vested=0, unvested=totalAllocation)
        uint256 unvested = totalAllocation - vested;

        // Send any vested but unclaimed tokens to beneficiary
        if (vested > claimed) {
            token.safeTransfer(beneficiary, vested - claimed);
        }

        // Return unvested tokens to owner
        token.safeTransfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
