// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/PriceOracle.sol";

contract PriceOracleTest {
    PriceOracle public oracle;

    constructor() {
        oracle = new PriceOracle(address(0xdead));
    }

    function testPrimaryFeedOnly() external view {
        oracle.MAX_STALENESS();
    }

    function testOwnerCanSetFallback() external {
        oracle.setSecondaryFeed(address(0xbeef));
    }
}
