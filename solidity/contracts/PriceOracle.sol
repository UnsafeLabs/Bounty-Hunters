// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PriceOracle {
    address public owner;
    address public fallbackOracle;

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint256 decimals;
    }

    PriceData public latestPrice;
    uint256 public constant STALENESS_THRESHOLD = 1 hours;
    uint256 public constant MAX_PRICE = 1e30;
    uint256 public constant MIN_PRICE = 1;

    event PriceUpdated(uint256 price, uint256 timestamp);
    event FallbackOracleUpdated(address fallbackOracle);

    constructor(address _fallbackOracle) {
        owner = msg.sender;
        fallbackOracle = _fallbackOracle;
    }

    // FIX: Add staleness check
    function getPrice() public view returns (uint256) {
        require(latestPrice.timestamp > 0, "No price set");
        require(
            block.timestamp - latestPrice.timestamp <= STALENESS_THRESHOLD,
            "Price is stale"
        );
        return latestPrice.price;
    }

    // FIX: Add fallback mechanism
    function getPriceWithFallback() external view returns (uint256) {
        if (latestPrice.timestamp > 0 &&
            block.timestamp - latestPrice.timestamp <= STALENESS_THRESHOLD) {
            return latestPrice.price;
        }
        // Try fallback oracle
        if (fallbackOracle != address(0)) {
            // Call fallback oracle (simplified)
            (bool success, bytes memory data) = fallbackOracle.staticcall(
                abi.encodeWithSignature("latestAnswer()")
            );
            if (success && data.length >= 32) {
                uint256 fallbackPrice = abi.decode(data, (uint256));
                if (fallbackPrice >= MIN_PRICE && fallbackPrice <= MAX_PRICE) {
                    return fallbackPrice;
                }
            }
        }
        revert("No valid price available");
    }

    // FIX: Add access control and validation
    function updatePrice(uint256 price) external {
        require(msg.sender == owner, "Not owner");
        require(price >= MIN_PRICE && price <= MAX_PRICE, "Price out of range");

        latestPrice = PriceData({
            price: price,
            timestamp: block.timestamp,
            decimals: 18
        });

        emit PriceUpdated(price, block.timestamp);
    }

    function setFallbackOracle(address _fallbackOracle) external {
        require(msg.sender == owner, "Not owner");
        fallbackOracle = _fallbackOracle;
        emit FallbackOracleUpdated(_fallbackOracle);
    }

    function isPriceFresh() external view returns (bool) {
        return latestPrice.timestamp > 0 &&
            block.timestamp - latestPrice.timestamp <= STALENESS_THRESHOLD;
    }
}
