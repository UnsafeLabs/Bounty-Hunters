// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * MockChainlinkFeed — configurable mock for testing PriceOracle.
 * Allows tests to set any return value for latestRoundData.
 */
contract MockChainlinkFeed {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    uint8 public decimals;

    constructor(uint8 _decimals) {
        decimals = _decimals;
        roundId = 100;
        answer = 200000000000;  // $2000 with 8 decimals
        startedAt = block.timestamp - 60;
        updatedAt = block.timestamp - 60;
        answeredInRound = 100;
    }

    function latestRoundData() external view returns (
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function setAnswer(int256 _answer) external { answer = _answer; }
    function setUpdatedAt(uint256 _updatedAt) external { updatedAt = _updatedAt; }
    function setRoundId(uint80 _roundId) external { roundId = _roundId; }
    function setAnsweredInRound(uint80 _answeredInRound) external { answeredInRound = _answeredInRound; }

    function setStale() external {
        updatedAt = block.timestamp - 7200;  // 2 hours ago
    }

    function setNegativePrice() external {
        answer = -1;
    }

    function setZeroPrice() external {
        answer = 0;
    }

    function setIncompleteRound() external {
        answeredInRound = roundId - 1;
    }
}

/**
 * PriceOracleTestHarness — tests all PriceOracle validation paths.
 * Tests valid price, stale, negative, zero, incomplete, and both-oracle-stale.
 */
contract PriceOracleTestHarness {
    MockChainlinkFeed public primary;
    MockChainlinkFeed public fallback;
    PriceOracle public oracle;

    int256 public latestResult;
    bool public lastCallSucceeded;
    bool public stalePriceEmitted;

    constructor() {
        primary = new MockChainlinkFeed(8);
        fallback = new MockChainlinkFeed(8);
        oracle = new PriceOracle(address(primary), address(fallback));
    }

    function testValidPrice() external {
        try oracle.getLatestPrice() returns (int256 price) {
            latestResult = price;
            lastCallSucceeded = true;
        } catch {
            lastCallSucceeded = false;
        }
    }

    function testStalePriceFallback() external {
        primary.setStale();
        try oracle.getLatestPrice() returns (int256 price) {
            latestResult = price;
            lastCallSucceeded = true;
        } catch {
            lastCallSucceeded = false;
        }
    }

    function testNegativePriceFallback() external {
        primary.setNegativePrice();
        try oracle.getLatestPrice() returns (int256 price) {
            latestResult = price;
            lastCallSucceeded = true;
        } catch {
            lastCallSucceeded = false;
        }
    }

    function testZeroPriceFallback() external {
        primary.setZeroPrice();
        try oracle.getLatestPrice() returns (int256 price) {
            latestResult = price;
            lastCallSucceeded = true;
        } catch {
            lastCallSucceeded = false;
        }
    }

    function testIncompleteRoundFallback() external {
        primary.setIncompleteRound();
        try oracle.getLatestPrice() returns (int256 price) {
            latestResult = price;
            lastCallSucceeded = true;
        } catch {
            lastCallSucceeded = false;
        }
    }

    function testBothOraclesStale() external {
        primary.setStale();
        fallback.setStale();
        try oracle.getLatestPrice() returns (int256 price) {
            latestResult = price;
            lastCallSucceeded = true;
        } catch {
            lastCallSucceeded = false;
        }
    }
}
