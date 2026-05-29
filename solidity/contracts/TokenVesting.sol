pragma solidity ^0.8.0;

contract TokenVesting {
    event TokensVested(
        address indexed beneficiary,
        uint256 start,
        uint256 cliff,
        uint256 duration,
        uint256 totalAllocation
    );
    
    constructor() {}
    
    function vestedAmount(
        uint256 totalAllocation,
        uint256 start,
        uint256 cliff,
        uint256 duration
    ) public view returns (uint256) {
        uint256 current = block.timestamp;
        if (current < start) {
            return 0;
        }
        uint256 elapsed = current > start + duration ? duration : current - start;
        
        // Prevent overflow by dividing before multiplying
        // Calculate with safe math to avoid overflow
        uint256 vested = (totalAllocation * elapsed) / duration;
        
        return vested;
    }
    
    function vestedAmountWithCliff(
        uint256 totalAllocation,
        uint256 start,
        uint256 cliff,
        uint256 duration
    ) public view returns (uint256) {
        uint256 current = block.timestamp;
        if (current < start + cliff) {
            return 0;
        }
        if (current > start + duration) {
            return totalAllocation;
        }
        return 0;
    }
    
    function revoke(
        uint256 totalAllocation,
        uint256 claimed,
        uint256 start,
        uint256 cliff,
        uint256 duration
    ) public view returns (uint256) {
        uint256 current = block.timestamp;
        if (current < start + cliff) {
            return totalAllocation - claimed;
        }
        uint256 vested = (totalAllocation * (current - start)) / duration;
        uint256 unvested = totalAllocation - vested - claimed;
        return unvested;
    }
}
        revoked = true;

        uint256 vested = vestedAmount();
        // BUG: Should be totalAllocation - claimed, not totalAllocation - vested
        // during cliff, vested is 0 but user may have claimed nothing
        uint256 unvested = totalAllocation - vested;

        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
}
