Looking at the issue description, I need to modify the PriceOracle.sol file to add proper validation for Chainlink price feeds. Let me create the necessary fixes:

```diff
--- a/solidity/contracts/PriceOracle.sol
+++ b/solidity/contracts/PriceOracle.sol
@@ -1,4 +1,4 @@
-// SPDX-License-Identifier: MIT
-pragma solidity ^0.8.0;
-
-import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
+// SPDX-License-Identifier: MIT
+pragma solidity ^0.8.0;
+
+import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
 
 contract PriceOracle {
-    AggregatorV3Interface public priceFeed;
-    address public immutable owner;
+    address public priceFeed1;
+    address public priceFeed2;
+    address public owner;
+    uint256 public MAX_STALENESS = 3600;
+    bool private isOwner;
 
-    constructor(address _priceFeed) {
-        priceFeed = AggregatorV3Interface(_priceFeed);
-        owner = msg.sender;
+    constructor(address _priceFeed1, address _priceFeed2) {
+        priceFeed1 = _priceFeed1;
+        priceFeed2 = _priceFeed2;
+        owner = msg.sender;
+        isOwner = true;
     }
 
-    function getLatestPrice() public view returns (int256) {
+    function setMaxStaleness(uint256 _maxStaleness) public {
+        require(msg.sender == owner, "Not authorized");
+        MAX_STALENESS = _maxStaleness;
+    }
+
+    function getLatestPrice() public returns (int256) {
+        (,int256 price,, uint256 updatedAt,) = AggregatorV308Interface(priceFeed1).latestRoundData();
+        
+        // Add validation after the latestRoundData call
+        require(price > 0, "Invalid price");
+        (uint80 roundId, int256 currentPrice, , uint256 currentUpdatedAt, ) = AggregatorV3Interface(priceFeed1).latestRoundData();
+        (uint80 currentRoundId, int256 currentPrice, , uint256 currentUpdatedAt, ) = AggregatorV3Interface(priceFeed1).latestRoundData();
+        
+        // Check round completeness
+        require(currentRoundId >= roundId, "Incomplete round");
+        
+        // Check for negative prices
+        require(currentPrice > 0, "Invalid price");
+        
+        // Check for staleness
+        require(block.timestamp - currentUpdatedAt < MAX_STALENESS, "Stale price");
+        
+        return currentPrice;
+    }
+
+    function getChainlinkPriceWithFallback(address _primaryFeed, address _fallbackFeed) public view returns (int256) {
+        (uint80 roundId, int256 price, , uint256 updatedAt, ) = AggregatorV3Interface(_primaryFeed).latestRoundData();
+        (uint80 fallbackRoundId, int256 fallbackPrice, , uint256 fallbackUpdatedAt, ) = AggregatorV3Interface(_fallbackFeed).latestRoundData();
+        
+        // Validate primary feed data
+        require(price > 0, "Invalid price");
+        require(roundId >= roundId, "Incomplete round");
+        require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");
+        
+        // If primary feed is stale, use fallback
+        if (block.timestamp - updatedAt >= MAX_STALENESS) {
+            emit StalePrice(roundId, updatedAt);
+            (, int256 fallbackPrice, , uint256 fallbackUpdatedAt, ) = AggregatorV3Interface(_fallbackFeed).latestRoundData();
+            require(fallbackPrice > 0, "Invalid fallback price");
+            require(fallbackRoundId >= roundId, "Incomplete fallback round");
+            require(block.timestamp - fallbackUpdatedAt < MAX_STALENESS, "Fallback also stale");
+            return fallbackPrice;
+        }
+        
+        return price;
+    }
+}
+
+interface AggregatorV3Interface {
+    function latestRoundData() external view returns (uint80, int256, uint256, uint80, uint80);
+}
+interface AggregatorV3Interface {
+    function latestRoundData() external view returns (uint80, int256, uint256, uint80, uint80);
+}
+
+interface AggregatorV3Interface {
+    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
+}
+
+interface AggregatorV3Interface {
+    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
+}
+
+contract PriceOracle {
+    address public priceFeed1;
+    address public priceFeed2;
+    address public owner;
+    uint256 public MAX_STALENESS;
+    bool private isOwner;
+
+    event StalePrice(uint80 indexed roundId, uint256 updatedAt);
+
+    constructor(address _priceFeed1, address _priceFeed2) {
+        priceFeed1 = _priceFeed1;
+        priceFeed2 = _priceFeed2;
+        owner = msg.sender;
+        isOwner = true;
+        MAX_STALENESS = 3600;
+    }
+
+    function getLatestPrice() public view returns (int256) {
+        (uint80 roundId, int256 price, , uint256 updatedAt, ) = AggregatorV3Interface(priceFeed1).latestRoundData();
+        (uint80 fallbackRoundId, int256 fallbackPrice, , uint256 fallbackUpdatedAt, ) = AggregatorV3Interface(priceFeed2).latestRoundData();
+        
+        // Validate primary feed
+        require(price > 0, "Invalid price");
+        require(roundId >= roundId, "Incomplete round");
+        if (block.timestamp - updatedAt >= MAX_STALENESS) {
+            emit StalePrice(roundId, updatedAt);
+            require(fallbackPrice > 0, "Invalid fallback price");
+            require(fallbackRoundId >= roundId, "Incomplete fallback round");
+            require(block.timestamp - fallbackUpdatedAt < MAX_STALENESS, "Fallback also stale");
+            return fallbackPrice;
+        }
+        
+        return price;
+    }
+}
+
+interface AggregatorV3Interface {
+    function latestRoundData() external view returns (uint80, int256, int256, uint256, uint80);
+}
+
+