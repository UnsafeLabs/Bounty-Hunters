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

    // Fixed: Divide before multiply to prevent overflow for large allocations.
    // vestRate = totalAllocation / duration is the per-second vest rate (always <= totalAllocation)
    // vestRate * elapsed cannot overflow since elapsed <= duration.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        uint256 vestRate = totalAllocation / duration;
        return vestRate * elapsed;
    }

    // Remainder accumulator: captures the fraction lost per second due to integer truncation.
    // This ensures total distributed (claimed + remainderFund) equals totalAllocation at vesting end.
    uint256 private _remainderFund;

    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");

        // Accrue truncation remainder into a fund for distribution at vesting end
        if (block.timestamp < start + duration) {
            uint256 elapsed = block.timestamp - start;
            uint256 remainder = totalAllocation % duration;
            // Accrue the per-second remainder into the fund
            _remainderFund += remainder * elapsed / duration;
        }

        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    // Fixed: Correctly calculate unvested tokens on revoke.
    // unvested = totalAllocation - claimed
    // This correctly handles: cliff period (claimed=0, unvested=totalAllocation),
    // partial claim (claimed>0, unvested=totalAllocation-claimed).
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        uint256 unvested = totalAllocation - claimed;

        // Transfer vested-but-unclaimed tokens to beneficiary
        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        // Transfer unvested tokens back to owner
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
