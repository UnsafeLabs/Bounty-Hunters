// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggregatorV3 {
    uint80 private s_roundId;
    int256 private s_answer;
    uint256 private s_startedAt;
    uint256 private s_updatedAt;
    uint80 private s_answeredInRound;
    uint8 private s_decimals;

    constructor(uint8 _decimals) {
        s_decimals = _decimals;
    }

    function setLatestRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        s_roundId = roundId;
        s_answer = answer;
        s_startedAt = startedAt;
        s_updatedAt = updatedAt;
        s_answeredInRound = answeredInRound;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (s_roundId, s_answer, s_startedAt, s_updatedAt, s_answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return s_decimals;
    }
}
