// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PriceOracle.sol";

contract MockAggregator is AggregatorV3Interface {
    uint8 internal _decimals;
    uint80 internal _roundId;
    int256 internal _answer;
    uint256 internal _startedAt;
    uint256 internal _updatedAt;
    uint80 internal _answeredInRound;
    bool internal _shouldRevert;

    constructor(uint8 decimals_) {
        _decimals = decimals_;
    }

    function setRoundData(
        uint80 roundId_,
        int256 answer_,
        uint256 startedAt_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        _roundId = roundId_;
        _answer = answer_;
        _startedAt = startedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
    }

    function setShouldRevert(bool shouldRevert) external {
        _shouldRevert = shouldRevert;
    }

    function latestRoundData() external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        require(!_shouldRevert, "Oracle reverted");
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }
}

contract PriceOracleTest is Test {
    PriceOracle oracle;
    MockAggregator primaryMock;
    MockAggregator fallbackMock;
    address owner = address(0x1);

    function setUp() public {
        primaryMock = new MockAggregator(8);
        fallbackMock = new MockAggregator(8);
        vm.prank(owner);
        oracle = new PriceOracle(
            address(primaryMock),
            address(fallbackMock)
        );
    }

    function testValidPrice() public view {
        primaryMock.setRoundData(1, 2000e8, block.timestamp - 10, block.timestamp - 10, 1);
        int256 price = oracle.getLatestPrice();
        assertEq(price, 2000e8);
    }

    function testStalePriceTriggersFallback() public {
        // Primary: stale (updated 7200s ago > 3600 MAX_STALENESS)
        primaryMock.setRoundData(1, 2000e8, block.timestamp - 7200, block.timestamp - 7200, 1);
        // Fallback: fresh
        fallbackMock.setRoundData(1, 2100e8, block.timestamp - 10, block.timestamp - 10, 1);

        vm.expectEmit(false, false, false, true);
        emit PriceOracle.StalePrice(block.timestamp - 7200, 7200);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    function testNegativePriceReverts() public {
        primaryMock.setRoundData(1, -100, block.timestamp - 10, block.timestamp - 10, 1);
        fallbackMock.setRoundData(1, -100, block.timestamp - 10, block.timestamp - 10, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testZeroPriceReverts() public {
        primaryMock.setRoundData(1, 0, block.timestamp - 10, block.timestamp - 10, 1);
        fallbackMock.setRoundData(1, 0, block.timestamp - 10, block.timestamp - 10, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testIncompleteRoundReverts() public {
        // answeredInRound < roundId means incomplete
        primaryMock.setRoundData(2, 2000e8, block.timestamp - 10, block.timestamp - 10, 1);
        fallbackMock.setRoundData(2, 2000e8, block.timestamp - 10, block.timestamp - 10, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testBothOraclesStaleReverts() public {
        primaryMock.setRoundData(1, 2000e8, block.timestamp - 7200, block.timestamp - 7200, 1);
        fallbackMock.setRoundData(1, 2100e8, block.timestamp - 7200, block.timestamp - 7200, 1);

        vm.expectRevert("Both oracles stale");
        oracle.getLatestPrice();
    }

    function testPrimaryRevertUsesFallback() public {
        primaryMock.setShouldRevert(true);
        fallbackMock.setRoundData(1, 2100e8, block.timestamp - 10, block.timestamp - 10, 1);

        vm.expectEmit(false, false, false, true);
        emit PriceOracle.FallbackUsed(2100e8, block.timestamp - 10);

        int256 price = oracle.getLatestPrice();
        assertEq(price, 2100e8);
    }

    function testBothOraclesRevert() public {
        primaryMock.setShouldRevert(true);
        fallbackMock.setShouldRevert(true);

        vm.expectRevert("Both oracles failed");
        oracle.getLatestPrice();
    }

    function testSetMaxStaleness() public {
        vm.prank(owner);
        oracle.setMaxStaleness(7200);
        assertEq(oracle.MAX_STALENESS(), 7200);
    }

    function testSetMaxStalenessNotOwner() public {
        vm.expectRevert("Not owner");
        oracle.setMaxStaleness(7200);
    }

    function testSetFallbackFeed() public {
        MockAggregator newFallback = new MockAggregator(8);
        vm.prank(owner);
        oracle.setFallbackFeed(address(newFallback));
        assertEq(address(oracle.fallbackFeed()), address(newFallback));
    }

    function testSetFallbackFeedZeroAddress() public {
        vm.expectRevert("Invalid fallback feed");
        vm.prank(owner);
        oracle.setFallbackFeed(address(0));
    }
}
