// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregatorV3 {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    uint8 public _decimals = 8;

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function setValues(uint80 _roundId, int256 _answer, uint256 _updatedAt, uint80 _answeredInRound) external {
        roundId = _roundId;
        answer = _answer;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }
}

contract PriceOracleTest is Test {
    PriceOracle oracle;
    MockAggregatorV3 primaryFeed;
    MockAggregatorV3 fallbackFeed;

    function setUp() public {
        primaryFeed = new MockAggregatorV3();
        fallbackFeed = new MockAggregatorV3();
        oracle = new PriceOracle(address(primaryFeed), address(fallbackFeed));
    }

    function test_ValidPrice() public {
        primaryFeed.setValues(100, 50000 * 10**8, block.timestamp, 100);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 50000 * 10**8);
    }

    function test_StalePriceTriggersFallback() public {
        // Primary feed is stale (updated 2 hours ago)
        primaryFeed.setValues(100, 50000 * 10**8, block.timestamp - 7200, 100);
        // Fallback is fresh
        fallbackFeed.setValues(200, 51000 * 10**8, block.timestamp, 200);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 51000 * 10**8, "Should return fallback price");
    }

    function test_NegativePriceReverts() public {
        primaryFeed.setValues(100, -1, block.timestamp, 100);
        fallbackFeed.setValues(200, -1, block.timestamp, 200);

        try oracle.getLatestPrice() {
            revert("Should have reverted");
        } catch (bytes memory reason) {
            assertTrue(true);
        }
    }

    function test_ZeroPriceReverts() public {
        primaryFeed.setValues(100, 0, block.timestamp, 100);
        fallbackFeed.setValues(200, 0, block.timestamp, 200);

        try oracle.getLatestPrice() {
            revert("Should have reverted");
        } catch (bytes memory reason) {
            assertTrue(true);
        }
    }

    function test_IncompleteRoundReverts() public {
        // answeredInRound < roundId means incomplete
        primaryFeed.setValues(100, 50000 * 10**8, block.timestamp, 99);
        fallbackFeed.setValues(200, 51000 * 10**8, block.timestamp, 199);

        try oracle.getLatestPrice() {
            revert("Should have reverted");
        } catch (bytes memory reason) {
            assertTrue(true);
        }
    }

    function test_BothOraclesStaleReverts() public {
        primaryFeed.setValues(100, 50000 * 10**8, block.timestamp - 7200, 100);
        fallbackFeed.setValues(200, 51000 * 10**8, block.timestamp - 7200, 200);

        try oracle.getLatestPrice() {
            revert("Should have reverted");
        } catch (bytes memory reason) {
            assertTrue(true);
        }
    }

    function test_SetMaxStaleness() public {
        oracle.setMaxStaleness(7200);
        // Now a 2-hour-old price should be accepted from primary
        primaryFeed.setValues(100, 50000 * 10**8, block.timestamp - 7200, 100);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 50000 * 10**8);
    }

    function test_GetDecimals() public {
        uint8 d = oracle.getDecimals();
        assertEq(d, 8);
    }

    function test_SetFallbackFeed() public {
        MockAggregatorV3 newFallback = new MockAggregatorV3();
        newFallback.setValues(300, 52000 * 10**8, block.timestamp, 300);
        oracle.setFallbackFeed(address(newFallback));

        // Primary stale, new fallback should work
        primaryFeed.setValues(100, 50000 * 10**8, block.timestamp - 7200, 100);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 52000 * 10**8);
    }
}
