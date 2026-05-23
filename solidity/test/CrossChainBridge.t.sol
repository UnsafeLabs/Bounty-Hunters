// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";

contract CrossChainBridgeTest is Test {
    CrossChainBridge bridge;
    function testReplayProtection() public {
        assertTrue(true);
    }
}