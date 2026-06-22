// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/PriceOracle.sol";

/// @title MockAggregator - A mock Chainlink aggregator for testing
contract MockAggregator is AggregatorV3Interface {
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;
    uint8 private _decimals;

    constructor() {
        _decimals = 8;
    }

    function setRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        _roundId = roundId;
        _answer = answer;
        _startedAt = startedAt;
        _updatedAt = updatedAt;
        _answeredInRound = answeredInRound;
    }

    function setDecimals(uint8 decimals_) external {
        _decimals = decimals_;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}
