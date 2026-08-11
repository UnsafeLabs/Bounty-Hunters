// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggregator {
    uint80 public roundId_;
    int256 public answer_;
    uint256 public startedAt_;
    uint256 public updatedAt_;
    uint80 public answeredInRound_;
    uint8 public decimals_ = 8;

    function setRound(uint80 roundId, int256 answer, uint256 updatedAt, uint80 answeredInRound) external {
        roundId_ = roundId;
        answer_ = answer;
        startedAt_ = updatedAt;
        updatedAt_ = updatedAt;
        answeredInRound_ = answeredInRound;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId_, answer_, startedAt_, updatedAt_, answeredInRound_);
    }

    function decimals() external view returns (uint8) {
        return decimals_;
    }
}
