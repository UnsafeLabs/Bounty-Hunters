// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title MockAggregator
 * @dev Mock Chainlink aggregator for testing
 */
contract MockAggregator is AggregatorV3Interface {
    int256 public mockPrice;
    uint256 public mockUpdatedAt;
    uint80 public mockRoundId;
    uint80 public mockAnsweredInRound;
    bool public shouldRevert;

    constructor() {
        mockPrice = 100e8; // $100 with 8 decimals
        mockUpdatedAt = block.timestamp;
        mockRoundId = 1;
        mockAnsweredInRound = 1;
        shouldRevert = false;
    }

    function setPrice(int256 _price) external {
        mockPrice = _price;
    }

    function setUpdatedAt(uint256 _timestamp) external {
        mockUpdatedAt = _timestamp;
    }

    function setRoundId(uint80 _roundId, uint80 _answeredInRound) external {
        mockRoundId = _roundId;
        mockAnsweredInRound = _answeredInRound;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        require(!shouldRevert, "Mock revert");
        return (
            mockRoundId,
            mockPrice,
            block.timestamp,
            mockUpdatedAt,
            mockAnsweredInRound
        );
    }

    function decimals() external pure override returns (uint8) {
        return 8;
    }

    function description() external pure override returns (string memory) {
        return "Mock Aggregator";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80)
        external
        pure
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        revert("Not implemented");
    }
}

/**
 * @title PriceOracleTest
 * @dev Test suite for PriceOracle contract
 */
contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primaryMock;
    MockAggregator public fallbackMock;

    function setUp() public {
        primaryMock = new MockAggregator();
        fallbackMock = new MockAggregator();
        oracle = new PriceOracle(address(primaryMock), address(fallbackMock));
    }

    function test_ValidPrice() public {
        primaryMock.setPrice(100e8);
        primaryMock.setUpdatedAt(block.timestamp);
        primaryMock.setRoundId(1, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 100e8);
    }

    function test_NegativePrice() public {
        primaryMock.setPrice(-100e8);
        primaryMock.setUpdatedAt(block.timestamp);
        primaryMock.setRoundId(1, 1);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_ZeroPrice() public {
        primaryMock.setPrice(0);
        primaryMock.setUpdatedAt(block.timestamp);
        primaryMock.setRoundId(1, 1);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_StalePrice() public {
        // Set primary oracle price to stale (older than 1 hour)
        uint256 staleTimestamp = block.timestamp - 3601;
        primaryMock.setPrice(100e8);
        primaryMock.setUpdatedAt(staleTimestamp);
        primaryMock.setRoundId(1, 1);

        // Fallback oracle has fresh price
        fallbackMock.setPrice(101e8);
        fallbackMock.setUpdatedAt(block.timestamp);
        fallbackMock.setRoundId(1, 1);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 101e8);
    }

    function test_StalePriceEmitsEvent() public {
        uint256 staleTimestamp = block.timestamp - 3601;
        primaryMock.setPrice(100e8);
        primaryMock.setUpdatedAt(staleTimestamp);
        primaryMock.setRoundId(1, 1);

        fallbackMock.setPrice(101e8);
        fallbackMock.setUpdatedAt(block.timestamp);
        fallbackMock.setRoundId(1, 1);

        vm.expectEmit(true, false, false, true);
        emit PriceOracle.StalePrice(address(primaryMock), staleTimestamp);
        oracle.getLatestPrice();
    }

    function test_IncompleteRound() public {
        primaryMock.setPrice(100e8);
        primaryMock.setUpdatedAt(block.timestamp);
        // Set answeredInRound < roundId to simulate incomplete round
        primaryMock.setRoundId(5, 3);

        vm.expectRevert("Incomplete round");
        oracle.getLatestPrice();
    }

    function test_BothOraclesStale() public {
        uint256 staleTimestamp = block.timestamp - 3601;

        // Both oracles are stale
        primaryMock.setPrice(100e8);
        primaryMock.setUpdatedAt(staleTimestamp);
        primaryMock.setRoundId(1, 1);

        fallbackMock.setPrice(101e8);
        fallbackMock.setUpdatedAt(staleTimestamp);
        fallbackMock.setRoundId(1, 1);

        vm.expectRevert("Stale price: both oracles returned stale data");
        oracle.getLatestPrice();
    }

    function test_FallbackWithNegativePrice() public {
        uint256 staleTimestamp = block.timestamp - 3601;

        primaryMock.setPrice(100e8);
        primaryMock.setUpdatedAt(staleTimestamp);
        primaryMock.setRoundId(1, 1);

        fallbackMock.setPrice(-101e8);
        fallbackMock.setUpdatedAt(block.timestamp);
        fallbackMock.setRoundId(1, 1);

        vm.expectRevert("Invalid price");
        oracle.getLatestPrice();
    }

    function test_SetMaxStaleness() public {
        uint256 newStaleness = 7200; // 2 hours
        oracle.setMaxStaleness(newStaleness);
        assertEq(oracle.maxStaleness(), newStaleness);
    }

    function test_SetMaxStalenessEmitsEvent() public {
        uint256 newStaleness = 7200;
        vm.expectEmit(false, false, false, true);
        emit PriceOracle.MaxStalenessUpdated(newStaleness);
        oracle.setMaxStaleness(newStaleness);
    }

    function test_SetMaxStalenessOnlyOwner() public {
        vm.prank(address(0x1));
        vm.expectRevert();
        oracle.setMaxStaleness(7200);
    }

    function test_SetFallbackOracle() public {
        MockAggregator newFallback = new MockAggregator();
        oracle.setFallbackOracle(address(newFallback));
        assertEq(address(oracle.fallbackOracle()), address(newFallback));
    }
}
