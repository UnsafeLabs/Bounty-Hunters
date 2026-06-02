// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/PriceOracle.sol";

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    MockAggregator public primaryFeed;
    MockAggregator public fallbackFeed;
    
    address public owner = address(1);
    address public user = address(2);
    
    int256 public constant PRICE = 1000 * 1e8; // $1000 with 8 decimals
    uint256 public constant MAX_STALENESS = 3600; // 1 hour
    
    function setUp() public {
        primaryFeed = new MockAggregator(PRICE);
        fallbackFeed = new MockAggregator(PRICE * 2);
        
        vm.prank(owner);
        oracle = new PriceOracle(address(primaryFeed), address(fallbackFeed));
    }
    
    // Test: Get latest price
    function test_GetLatestPrice() public {
        int256 price = oracle.getLatestPrice();
        assertEq(price, PRICE, "Price should match");
    }
    
    // Test: Price staleness check
    function test_PriceStaleness() public {
        // Set primary feed price to be stale
        primaryFeed.setUpdatedAt(block.timestamp - MAX_STALENESS - 1);
        
        // Should revert with stale price
        vm.expectRevert("Price data stale");
        oracle.getLatestPrice();
    }
    
    // Test: Zero price check
    function test_ZeroPrice() public {
        // Set primary feed price to 0
        primaryFeed.setPrice(0);
        
        // Should revert with invalid price
        vm.expectRevert("Invalid price: zero or negative");
        oracle.getLatestPrice();
    }
    
    // Test: Negative price check
    function test_NegativePrice() public {
        // Set primary feed price to negative
        primaryFeed.setPrice(-100);
        
        // Should revert with invalid price
        vm.expectRevert("Invalid price: zero or negative");
        oracle.getLatestPrice();
    }
    
    // Test: Round completeness check
    function test_RoundCompleteness() public {
        // Set answeredInRound < roundId
        primaryFeed.setRoundData(2, PRICE, block.timestamp, block.timestamp, 1);
        
        // Should revert with stale round
        vm.expectRevert("Stale round");
        oracle.getLatestPrice();
    }
    
    // Test: Fallback oracle
    function test_FallbackOracle() public {
        // Make primary feed stale
        primaryFeed.setUpdatedAt(block.timestamp - MAX_STALENESS - 1);
        
        // Enable fallback
        vm.prank(owner);
        oracle.setUseFallback(true);
        
        // Should use fallback price
        int256 price = oracle.getLatestPrice();
        assertEq(price, PRICE * 2, "Should use fallback price");
    }
    
    // Test: Access control
    function test_AccessControl() public {
        // Non-owner cannot set max staleness
        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        oracle.setMaxStaleness(7200);
        
        // Non-owner cannot set use fallback
        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        oracle.setUseFallback(true);
    }
    
    // Test: Set max staleness
    function test_SetMaxStaleness() public {
        vm.prank(owner);
        oracle.setMaxStaleness(7200);
        
        assertEq(oracle.maxStaleness(), 7200, "Max staleness should be updated");
    }
    
    // Test: Invalid max staleness
    function test_InvalidMaxStaleness() public {
        vm.prank(owner);
        vm.expectRevert("Invalid staleness");
        oracle.setMaxStaleness(0);
    }
    
    // Test: Get decimals
    function test_GetDecimals() public {
        uint8 decimals = oracle.getDecimals();
        assertEq(decimals, 8, "Decimals should be 8");
    }
}

contract MockAggregator {
    int256 public price;
    uint8 public decimals = 8;
    uint256 public updatedAt;
    uint80 public roundId;
    uint80 public answeredInRound;
    
    constructor(int256 _price) {
        price = _price;
        updatedAt = block.timestamp;
        roundId = 1;
        answeredInRound = 1;
    }
    
    function latestRoundData() external view returns (
        uint80 roundId_,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) {
        return (roundId, price, updatedAt, updatedAt, answeredInRound);
    }
    
    function setPrice(int256 _price) external {
        price = _price;
    }
    
    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }
    
    function setRoundData(uint80 _roundId, int256 _price, uint256 _startedAt, uint256 _updatedAt, uint80 _answeredInRound) external {
        roundId = _roundId;
        price = _price;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }
}
