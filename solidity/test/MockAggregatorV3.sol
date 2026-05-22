// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggregatorV3 {
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;
    uint80 public answeredInRound;
    uint8 public decimalsValue;

    constructor(int256 _answer, uint256 _updatedAt, uint8 _decimals) {
        answer = _answer;
        updatedAt = _updatedAt;
        roundId = 1;
        answeredInRound = 1;
        decimalsValue = _decimals;
    }

    function setAnswer(int256 _answer) external {
        answer = _answer;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function setDecimals(uint8 _decimals) external {
        decimalsValue = _decimals;
    }

    function setRoundData(uint80 _roundId, int256 _answer, uint256 _updatedAt, uint80 _answeredInRound) external {
        roundId = _roundId;
        answer = _answer;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 _roundId,
            int256 _answer,
            uint256 _startedAt,
            uint256 _updatedAt,
            uint80 _answeredInRound
        )
    {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return decimalsValue;
    }
}
