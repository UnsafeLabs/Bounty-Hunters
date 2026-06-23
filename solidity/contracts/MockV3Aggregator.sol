// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PriceOracle.sol";

contract MockV3Aggregator is AggregatorV3Interface {
    uint80 private roundId;
    int256 private answer;
    uint256 private startedAt;
    uint256 private updatedAt;
    uint80 private answeredInRound;
    uint8 private decs;

    bool public shouldRevert;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decs = _decimals;
        answer = _initialAnswer;
        roundId = 1;
        answeredInRound = 1;
        updatedAt = block.timestamp;
    }

    function updateRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function latestRoundData() external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        if (shouldRevert) {
            revert("Aggregator Error");
        }
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view override returns (uint8) {
        if (shouldRevert) {
            revert("Aggregator Error");
        }
        return decs;
    }
}
