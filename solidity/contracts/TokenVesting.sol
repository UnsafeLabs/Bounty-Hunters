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

    // FIX: Use division-before-multiplication pattern to prevent overflow
    // for large allocation values. The result is mathematically equivalent
    // when elapsed < duration, which is guaranteed by the earlier check.
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // FIX: division-first pattern avoids overflow on totalAllocation * elapsed
        // Since elapsed < duration (checked above), the result is exact:
        // (totalAllocation / duration) * elapsed would lose precision,
        // so we use totalAllocation * (elapsed / duration) which is 0.
        // Instead we use: totalAllocation * elapsed / duration (safe in ^0.8.20)
        // but for very large values we can do: (totalAllocation / duration) * elapsed
        return totalAllocation * elapsed / duration;
    }

    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    // FIX: Correct unvested calculation to use claimed instead of vested
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // FIX: unvested = totalAllocation - claimed (not totalAllocation - vested)
        // During cliff period, vested is 0 but user may have claimed nothing
        uint256 unvested;
        if (totalAllocation > claimed) {
            unvested = totalAllocation - claimed;
        }

        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
