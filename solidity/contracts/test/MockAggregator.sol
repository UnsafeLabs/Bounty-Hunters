// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggregator {
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;
    uint80 private _answeredInRound;

    constructor(int256 answer, uint256 updatedAt, uint80 roundId, uint80 answeredInRound) {
        _answer = answer;
        _updatedAt = updatedAt;
        _roundId = roundId;
        _answeredInRound = answeredInRound;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return 8;
    }
}
