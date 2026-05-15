// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../TokenVesting.sol";

contract TokenVestingHarness is TokenVesting {
    constructor(
        address token_,
        address beneficiary_,
        uint256 totalAllocation_,
        uint256 start_,
        uint256 cliffDuration_,
        uint256 vestingDuration_
    )
        TokenVesting(
            token_,
            beneficiary_,
            totalAllocation_,
            start_,
            cliffDuration_,
            vestingDuration_
        )
    {}

    function vestedAmountAt(uint256 timestamp) external view returns (uint256) {
        return _vestedAmount(timestamp);
    }
}
