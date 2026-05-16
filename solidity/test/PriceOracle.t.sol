solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/// @title MockAggregator
/// @notice A mock Chainlink aggregator for testing price oracle logic.
contract MockAggregator is AggregatorV3Interface {
    uint80 private _roundId;
    int256 private _price;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;
    uint8 private _decimals;

    /// @notice Set the latest round data for the mock.
    /// @param roundId The round ID.
    /// @param price The price (as int256).
    /// @param updatedAt The timestamp of the update.
    /// @param answeredInRound The round in which the answer was computed.
    function setLatestRoundData(
        uint80 roundId,
        int256 price,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        _roundId = roundId;
        _price = price;
        _updatedAt = updatedAt;
        _answeredInRound = answeredInRound;
    }

    /// @inheritdoc AggregatorV3Interface
    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    /// @inheritdoc AggregatorV3Interface
    function description() external view override returns (string memory) {
        return "MockAggregator";
    }

    /// @inheritdoc AggregatorV3Interface
    function version() external view override returns (uint256) {
        return 1;
    }

    /// @inheritdoc AggregatorV3Interface
    function getRoundData(uint80 _roundId)
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
        return (_roundId, _price, block.timestamp, _updatedAt, _answeredInRound);
    }

    /// @inheritdoc AggregatorV3Interface
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
        return (_roundId, _price, block.timestamp, _updatedAt, _answeredInRound);
    }
}

/// @title PriceOracleTest
/// @notice Comprehensive unit tests for PriceOracle contract.
contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primaryMock;
    MockAggregator public secondaryMock;
    address public owner = address(this);
    address public nonOwner = address(0x1234);

    /// @notice Default staleness threshold (1 hour in seconds).
    uint256 constant DEFAULT_MAX_STALENESS = 3600;

    /// @notice Setup: deploy mocks and oracle instance before each test.
    function setUp() public {
        primaryMock = new MockAggregator();
        secondaryMock = new MockAggregator();
        oracle = new PriceOracle(
            address(primaryMock),
            address(secondaryMock),
            DEFAULT_MAX_STALENESS
        );
    }

    // =============================================================
    //  1. Standard price retrieval tests
    // =============================================================

    /// @notice Test that a valid price from the primary oracle is returned.
    function testValidPrice() public {
        uint80 roundId = 1;
        int256 price = 2000e8; // $2000
        uint256 updatedAt = block.timestamp;
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        uint256 result = oracle.getPrice();
        assertEq(result, uint256(price));
    }

    /// @notice Test that a valid price from the secondary oracle is returned when primary is stale.
    function testStalePrimaryValidSecondary() public {
        uint80 roundId = 1;
        int256 price = 2000e8;
        uint256 staleTime = block.timestamp - DEFAULT_MAX_STALENESS - 1;
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, staleTime, answeredInRound);

        // Secondary returns fresh price
        uint256 freshPrice = 2010e8;
        uint256 freshTime = block.timestamp;
        secondaryMock.setLatestRoundData(
            roundId + 1,
            int256(freshPrice),
            freshTime,
            roundId + 1
        );

        uint256 result = oracle.getPrice();
        assertEq(result, freshPrice);
    }

    // =============================================================
    //  2. Staleness and fallback tests
    // =============================================================

    /// @notice Test that the contract reverts when both oracles return stale data.
    function testBothStale() public {
        uint80 roundId = 1;
        int256 price = 2000e8;
        uint256 staleTime = block.timestamp - DEFAULT_MAX_STALENESS - 1;
        uint80 answeredInRound = roundId;

        primaryMock.setLatestRoundData(roundId, price, staleTime, answeredInRound);
        secondaryMock.setLatestRoundData(roundId, price, staleTime, answeredInRound);

        vm.expectRevert("Both oracles stale");
        oracle.getPrice();
    }

    /// @notice Test that the StalePrice event is emitted when falling back to secondary.
    function testStalePriceEvent() public {
        uint80 roundId = 1;
        int256 price = 2000e8;
        uint256 staleTime = block.timestamp - DEFAULT_MAX_STALENESS - 1;
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, staleTime, answeredInRound);

        // Secondary returns fresh price
        uint256 freshPrice = 2010e8;
        uint256 freshTime = block.timestamp;
        secondaryMock.setLatestRoundData(
            roundId + 1,
            int256(freshPrice),
            freshTime,
            roundId + 1
        );

        vm.expectEmit(true, true, true, true);
        emit StalePrice(staleTime);
        oracle.getPrice();
    }

    // =============================================================
    //  3. Invalid price rejection
    // =============================================================

    /// @notice Test negative price from primary reverts.
    function testNegativePrice() public {
        uint80 roundId = 1;
        int256 price = -100;
        uint256 updatedAt = block.timestamp;
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        vm.expectRevert("Invalid price");
        oracle.getPrice();
    }

    /// @notice Test zero price from primary reverts.
    function testZeroPrice() public {
        uint80 roundId = 1;
        int256 price = 0;
        uint256 updatedAt = block.timestamp;
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        vm.expectRevert("Invalid price");
        oracle.getPrice();
    }

    /// @notice Test that a negative price from secondary (when primary is stale) reverts.
    function testNegativePriceSecondary() public {
        uint80 roundId = 1;
        int256 validPrice = 2000e8;
        uint256 staleTime = block.timestamp - DEFAULT_MAX_STALENESS - 1;
        uint80 answeredInRound = roundId;

        // Primary stale
        primaryMock.setLatestRoundData(roundId, validPrice, staleTime, answeredInRound);

        // Secondary returns negative price
        int256 negativePrice = -500;
        secondaryMock.setLatestRoundData(
            roundId + 1,
            negativePrice,
            block.timestamp,
            roundId + 1
        );

        vm.expectRevert("Invalid price");
        oracle.getPrice();
    }

    /// @notice Test that a zero price from secondary (when primary is stale) reverts.
    function testZeroPriceSecondary() public {
        uint80 roundId = 1;
        int256 validPrice = 2000e8;
        uint256 staleTime = block.timestamp - DEFAULT_MAX_STALENESS - 1;
        uint80 answeredInRound = roundId;

        primaryMock.setLatestRoundData(roundId, validPrice, staleTime, answeredInRound);

        // Secondary returns zero price
        secondaryMock.setLatestRoundData(
            roundId + 1,
            0,
            block.timestamp,
            roundId + 1
        );

        vm.expectRevert("Invalid price");
        oracle.getPrice();
    }

    // =============================================================
    //  4. Incomplete round rejection
    // =============================================================

    /// @notice Test incomplete round on primary reverts.
    function testIncompleteRound() public {
        uint80 roundId = 5;
        int256 price = 2000e8;
        uint256 updatedAt = block.timestamp;
        uint80 answeredInRound = 4; // less than roundId
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        vm.expectRevert("Incomplete round");
        oracle.getPrice();
    }

    /// @notice Test incomplete round on secondary (when primary is stale) reverts.
    function testIncompleteRoundSecondary() public {
        uint80 roundId = 5;
        int256 validPrice = 2000e8;
        uint256 staleTime = block.timestamp - DEFAULT_MAX_STALENESS - 1;
        uint80 answeredInRound = roundId;

        // Primary stale
        primaryMock.setLatestRoundData(roundId, validPrice, staleTime, answeredInRound);

        // Secondary returns incomplete round
        secondaryMock.setLatestRoundData(
            roundId + 1,
            validPrice + 10,
            block.timestamp,
            roundId // answeredInRound < roundId+1
        );

        vm.expectRevert("Incomplete round");
        oracle.getPrice();
    }

    // =============================================================
    //  5. Owner configuration tests
    // =============================================================

    /// @notice Test that the owner can update maxStaleness.
    function testCustomMaxStaleness() public {
        uint256 newMaxStaleness = 1800;
        oracle.setMaxStaleness(newMaxStaleness);

        // Set primary just within new staleness window
        uint80 roundId = 1;
        int256 price = 2000e8;
        uint256 updatedAt = block.timestamp - newMaxStaleness + 1;
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        uint256 result = oracle.getPrice();
        assertEq(result, uint256(price));
        assertEq(oracle.maxStaleness(), newMaxStaleness);
    }

    /// @notice Test that the owner can update the secondary oracle address.
    function testSetSecondaryOracle() public {
        address newSecondary = address(0x5678);
        oracle.setSecondaryOracle(newSecondary);
        assertEq(oracle.secondaryOracle(), newSecondary);
    }

    /// @notice Test that setting secondary oracle to zero address reverts.
    function testSetSecondaryOracleZeroAddress() public {
        vm.expectRevert("Invalid oracle address");
        oracle.setSecondaryOracle(address(0));
    }

    /// @notice Test that setting maxStaleness to zero reverts.
    function testSetMaxStalenessZero() public {
        vm.expectRevert("Invalid max staleness");
        oracle.setMaxStaleness(0);
    }

    /// @notice Test that non-owner cannot set maxStaleness.
    function testSetMaxStalenessRevertNonOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert("Ownable: caller is not the owner");
        oracle.setMaxStaleness(1800);
    }

    /// @notice Test that non-owner cannot set secondary oracle.
    function testSetSecondaryOracleRevertNonOwner() public {
        vm.prank(nonOwner);
        vm.expectRevert("Ownable: caller is not the owner");
        oracle.setSecondaryOracle(address(0x5678));
    }

    // =============================================================
    //  6. Edge case: primary valid, secondary not used
    // =============================================================

    /// @notice Test that even if secondary returns stale, primary valid price is used.
    function testPrimaryValidSecondaryStaleIgnored() public {
        uint80 roundId = 1;
        int256 price = 2000e8;
        uint256 updatedAt = block.timestamp;
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        // Secondary stale (should be ignored)
        secondaryMock.setLatestRoundData(
            roundId + 1,
            price + 10,
            block.timestamp - DEFAULT_MAX_STALENESS - 1,
            roundId + 1
        );

        uint256 result = oracle.getPrice();
        assertEq(result, uint256(price));
    }

    // =============================================================
    //  7. Staleness boundary tests
    // =============================================================

    /// @notice Test that a price exactly at the staleness threshold is accepted.
    function testStaleBoundaryAccepted() public {
        uint80 roundId = 1;
        int256 price = 2000e8;
        uint256 updatedAt = block.timestamp - DEFAULT_MAX_STALENESS + 1; // just inside
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        uint256 result = oracle.getPrice();
        assertEq(result, uint256(price));
    }

    /// @notice Test that a price exactly at staleness threshold+1 is rejected.
    function testStaleBoundaryRejected() public {
        uint80 roundId = 1;
        int256 price = 2000e8;
        uint256 updatedAt = block.timestamp - DEFAULT_MAX_STALENESS - 1; // just outside
        uint80 answeredInRound = roundId;
        primaryMock.setLatestRoundData(roundId, price, updatedAt, answeredInRound);

        // Need secondary to be fresh, otherwise revert.
        secondaryMock.setLatestRoundData(
            roundId + 1,
            price + 5,
            block.timestamp,
            roundId + 1
        );

        uint256 result = oracle.getPrice();
        assertEq(result, uint256(price + 5));
    }
}