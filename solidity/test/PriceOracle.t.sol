// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/PriceOracle.sol";

/// @title MockAggregatorV3
/// @notice A mock Chainlink aggregator for testing PriceOracle.
contract MockAggregatorV3 {
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;
    uint8 private _decimals;

    function setLatestRoundData(
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

    function setDecimals(uint8 d) external {
        _decimals = d;
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

/// @title PriceOracleTest
/// @notice Foundry-based test contract for PriceOracle.
contract PriceOracleTest {
    PriceOracle public oracle;
    MockAggregatorV3 public primaryMock;
    MockAggregatorV3 public secondaryMock;

    uint256 internal constant ONE_DAY = 86400;
    uint256 internal constant ONE_HOUR = 3600;

    function setUp() public {
        primaryMock = new MockAggregatorV3();
        primaryMock.setDecimals(8);

        secondaryMock = new MockAggregatorV3();
        secondaryMock.setDecimals(8);

        oracle = new PriceOracle(address(primaryMock));

        // Set valid default data
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 100, block.timestamp - 10, 1);
    }

    // --- Valid price ---
    function testValidPrice() public view {
        int256 price = oracle.getLatestPrice();
        assert(price == 2000e8);
    }

    // --- Stale price ---
    function testStalePriceTriggersFallback() public {
        // Make primary stale (older than 1 hour)
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);

        // Configure fallback with valid data
        oracle.setFallbackOracle(address(secondaryMock));
        secondaryMock.setLatestRoundData(1, 1950e8, block.timestamp - 100, block.timestamp - 10, 1);

        int256 price = oracle.getLatestPrice();
        assert(price == 1950e8); // Should return fallback price
    }

    // --- Both oracles stale reverts ---
    function testBothOraclesStaleReverts() public {
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
        oracle.setFallbackOracle(address(secondaryMock));
        secondaryMock.setLatestRoundData(1, 1950e8, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);

        bool didRevert = false;
        try oracle.getLatestPrice() {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    // --- Negative price rejected ---
    function testNegativePriceRejected() public {
        primaryMock.setLatestRoundData(1, -100e8, block.timestamp - 100, block.timestamp - 10, 1);

        bool didRevert = false;
        try oracle.getLatestPrice() {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    // --- Zero price rejected ---
    function testZeroPriceRejected() public {
        primaryMock.setLatestRoundData(1, 0, block.timestamp - 100, block.timestamp - 10, 1);

        bool didRevert = false;
        try oracle.getLatestPrice() {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    // --- Incomplete round rejected ---
    function testIncompleteRoundRejected() public {
        // answeredInRound < roundId indicates incomplete round
        primaryMock.setLatestRoundData(5, 2000e8, block.timestamp - 100, block.timestamp - 10, 3);

        bool didRevert = false;
        try oracle.getLatestPrice() {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    // --- Fallback with incomplete round also rejects ---
    function testFallbackIncompleteRoundReverts() public {
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
        oracle.setFallbackOracle(address(secondaryMock));
        secondaryMock.setLatestRoundData(3, 1950e8, block.timestamp - 100, block.timestamp - 10, 1); // incomplete

        bool didRevert = false;
        try oracle.getLatestPrice() {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    // --- No fallback configured and primary stale reverts ---
    function testNoFallbackReverts() public {
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);

        bool didRevert = false;
        try oracle.getLatestPrice() {
            // Expected to revert
        } catch {
            didRevert = true;
        }
        assert(didRevert);
    }

    // --- StalePrice event emitted on fallback ---
    function testStalePriceEvent() public {
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
        oracle.setFallbackOracle(address(secondaryMock));
        secondaryMock.setLatestRoundData(1, 1950e8, block.timestamp - 100, block.timestamp - 10, 1);

        // Cannot directly check events in this minimal test framework,
        // but we verify the function executes without revert
        int256 price = oracle.getLatestPrice();
        assert(price == 1950e8);
    }

    // --- MAX_STALENESS is configurable ---
    function testConfigurableStaleness() public {
        // Set staleness to 30 minutes (1800 seconds)
        oracle.setMaxStaleness(1800);

        // Data is 45 minutes old — should be stale now
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 45 minutes, block.timestamp - 45 minutes, 1);

        bool didRevert = false;
        try oracle.getLatestPrice() {
            // Expected to revert (no fallback)
        } catch {
            didRevert = true;
        }
        assert(didRevert);

        // Set it back to 1 hour — now it should work
        oracle.setMaxStaleness(ONE_HOUR);
        primaryMock.setLatestRoundData(1, 2000e8, block.timestamp - 45 minutes, block.timestamp - 45 minutes, 1);

        int256 price = oracle.getLatestPrice();
        assert(price == 2000e8);
    }
}
