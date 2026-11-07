// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    uint8 public decimals_;

    constructor(uint8 _decimals) {
        decimals_ = _decimals;
    }

    function setRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function decimals() external view override returns (uint8) {
        return decimals_;
    }
}

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primaryFeed;
    MockAggregator public fallbackFeed;
    address public owner = address(this);
    address public user = address(0x123);

    function setUp() public {
        primaryFeed = new MockAggregator(8);
        fallbackFeed = new MockAggregator(8);
        oracle = new PriceOracle(address(primaryFeed));
    }

    // ============ Constructor Tests ============

    function test_ConstructorSetsPrimaryFeed() public {
        assertEq(address(oracle.primaryFeed()), address(primaryFeed));
    }

    function test_ConstructorSetsOwner() public {
        assertEq(oracle.owner(), owner);
    }

    function test_ConstructorSetsDefaultMaxStaleness() public {
        assertEq(oracle.MAX_STALENESS(), 3600);
    }

    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert("Invalid feed address");
        new PriceOracle(address(0));
    }

    // ============ getLatestPrice Tests ============

    function test_GetLatestPriceReturnsValidPrice() public {
        _setValidPrice(primaryFeed, 2000e8);
        
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function test_GetLatestPriceRevertsOnZeroPrice() public {
        primaryFeed.setRoundData(1, 0, block.timestamp, block.timestamp, 1);
        
        vm.expectRevert("No valid price available");
        oracle.getLatestPrice();
    }

    function test_GetLatestPriceRevertsOnNegativePrice() public {
        primaryFeed.setRoundData(1, -100e8, block.timestamp, block.timestamp, 1);
        
        vm.expectRevert("No valid price available");
        oracle.getLatestPrice();
    }

    function test_GetLatestPriceRevertsOnStalePrice() public {
        uint256 staleTime = block.timestamp - 3601; // 1 hour + 1 second ago
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        
        vm.expectRevert("No valid price available");
        oracle.getLatestPrice();
    }

    function test_GetLatestPriceRevertsOnIncompleteRound() public {
        // answeredInRound < roundId indicates incomplete round
        primaryFeed.setRoundData(5, 2000e8, block.timestamp, block.timestamp, 3);
        
        vm.expectRevert("No valid price available");
        oracle.getLatestPrice();
    }

    function test_GetLatestPriceUsesFallbackWhenPrimaryFails() public {
        // Set primary to fail
        primaryFeed.setRoundData(1, 0, block.timestamp, block.timestamp, 1);
        
        // Set fallback feed
        vm.prank(owner);
        oracle.setFallbackFeed(address(fallbackFeed));
        
        // Set valid price on fallback
        _setValidPrice(fallbackFeed, 2100e8);
        
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    function test_GetLatestPriceUsesFallbackWhenPrimaryStale() public {
        // Set primary to stale
        uint256 staleTime = block.timestamp - 3601;
        primaryFeed.setRoundData(1, 2000e8, staleTime, staleTime, 1);
        
        // Set fallback feed
        vm.prank(owner);
        oracle.setFallbackFeed(address(fallbackFeed));
        
        // Set valid price on fallback
        _setValidPrice(fallbackFeed, 2100e8);
        
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    function test_GetLatestPriceRevertsWhenBothFeedsFail() public {
        // Both feeds return zero price
        primaryFeed.setRoundData(1, 0, block.timestamp, block.timestamp, 1);
        fallbackFeed.setRoundData(1, 0, block.timestamp, block.timestamp, 1);
        
        vm.prank(owner);
        oracle.setFallbackFeed(address(fallbackFeed));
        
        vm.expectRevert("No valid price available");
        oracle.getLatestPrice();
    }

    // ============ setFallbackFeed Tests ============

    function test_SetFallbackFeed() public {
        vm.prank(owner);
        oracle.setFallbackFeed(address(fallbackFeed));
        
        assertEq(address(oracle.fallbackFeed()), address(fallbackFeed));
    }

    function test_SetFallbackFeedEmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit PriceOracle.FallbackFeedSet(address(fallbackFeed));
        oracle.setFallbackFeed(address(fallbackFeed));
    }

    function test_SetFallbackFeedRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        oracle.setFallbackFeed(address(fallbackFeed));
    }

    function test_SetFallbackFeedRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Invalid feed address");
        oracle.setFallbackFeed(address(0));
    }

    // ============ setMaxStaleness Tests ============

    function test_SetMaxStaleness() public {
        uint256 newStaleness = 7200; // 2 hours
        
        vm.prank(owner);
        oracle.setMaxStaleness(newStaleness);
        
        assertEq(oracle.MAX_STALENESS(), newStaleness);
    }

    function test_SetMaxStalenessEmitsEvent() public {
        uint256 newStaleness = 7200;
        
        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit PriceOracle.MaxStalenessUpdated(newStaleness);
        oracle.setMaxStaleness(newStaleness);
    }

    function test_SetMaxStalenessRevertsOnNonOwner() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }

    function test_SetMaxStalenessRevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert("Invalid staleness");
        oracle.setMaxStaleness(0);
    }

    function test_SetMaxStalenessRevertsOnTooShort() public {
        vm.prank(owner);
        vm.expectRevert("Too short");
        oracle.setMaxStaleness(30); // Less than 1 minute
    }

    function test_SetMaxStalenessAcceptsMinimum() public {
        vm.prank(owner);
        oracle.setMaxStaleness(60); // Exactly 1 minute
        
        assertEq(oracle.MAX_STALENESS(), 60);
    }

    // ============ getDecimals Tests ============

    function test_GetDecimals() public {
        uint8 decimals = oracle.getDecimals();
        assertEq(decimals, 8);
    }

    // ============ Edge Cases ============

    function test_PriceAtExactStalenessBoundary() public {
        // Price exactly at MAX_STALENESS should fail
        uint256 exactTime = block.timestamp - 3600;
        primaryFeed.setRoundData(1, 2000e8, exactTime, exactTime, 1);
        
        vm.expectRevert("No valid price available");
        oracle.getLatestPrice();
    }

    function test_PriceJustBeforeStalenessBoundary() public {
        // Price 1 second before MAX_STALENESS should succeed
        uint256 justBefore = block.timestamp - 3599;
        primaryFeed.setRoundData(1, 2000e8, justBefore, justBefore, 1);
        
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function test_RoundCompletenessExactMatch() public {
        // answeredInRound == roundId should succeed
        primaryFeed.setRoundData(5, 2000e8, block.timestamp, block.timestamp, 5);
        
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function test_RoundCompletenessExceeds() public {
        // answeredInRound > roundId should succeed
        primaryFeed.setRoundData(5, 2000e8, block.timestamp, block.timestamp, 10);
        
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    // ============ Helper Functions ============

    function _setValidPrice(MockAggregator feed, int256 price) internal {
        uint80 roundId = 1;
        feed.setRoundData(
            roundId,
            price,
            block.timestamp,
            block.timestamp,
            roundId
        );
    }
}
