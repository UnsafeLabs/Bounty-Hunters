// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CrossChainBridge} from "../contracts/CrossChainBridge.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge bridge;
    MockToken token;
    address validator;
    uint256 validatorKey;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        (validator, validatorKey) = makeAddrAndKey("validator");
        token = new MockToken();
        bridge = new CrossChainBridge(address(token), validator);
        token.mint(address(bridge), 1_000e18);
    }

    function _sign(address sender, address recipient, uint256 amount, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = bridge.hashTransfer(sender, recipient, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_HappyPath() public {
        bytes memory sig = _sign(alice, bob, 10e18, 0);
        bridge.processTransfer(alice, bob, 10e18, 0, sig);
        assertEq(token.balanceOf(bob), 10e18);
        assertEq(bridge.nonces(alice), 1);
    }

    function test_SameChainReplayRejectedByNonce() public {
        bytes memory sig = _sign(alice, bob, 10e18, 0);
        bridge.processTransfer(alice, bob, 10e18, 0, sig);
        vm.expectRevert(
            abi.encodeWithSelector(CrossChainBridge.InvalidNonce.selector, 1, 0)
        );
        bridge.processTransfer(alice, bob, 10e18, 0, sig);
    }

    function test_CrossChainReplayRejected() public {
        bytes memory sig = _sign(alice, bob, 10e18, 0);
        bridge.processTransfer(alice, bob, 10e18, 0, sig);

        vm.chainId(137);
        CrossChainBridge other = new CrossChainBridge(address(token), validator);
        token.mint(address(other), 1_000e18);
        vm.expectRevert(CrossChainBridge.InvalidSignature.selector);
        other.processTransfer(alice, bob, 10e18, 0, sig);
    }

    function test_ReplayAfterRedeployRejected() public {
        bytes memory sig = _sign(alice, bob, 10e18, 0);
        CrossChainBridge upgraded = new CrossChainBridge(address(token), validator);
        token.mint(address(upgraded), 1_000e18);
        vm.expectRevert(CrossChainBridge.InvalidSignature.selector);
        upgraded.processTransfer(alice, bob, 10e18, 0, sig);
    }

    function test_InvalidSignatureRejected() public {
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        bytes32 digest = bridge.hashTransfer(alice, bob, 10e18, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(strangerKey, digest);
        vm.expectRevert(CrossChainBridge.InvalidSignature.selector);
        bridge.processTransfer(alice, bob, 10e18, 0, abi.encodePacked(r, s, v));
    }

    function test_MalformedSignatureRejected() public {
        vm.expectRevert();
        bridge.processTransfer(alice, bob, 10e18, 0, hex"0011");
    }

    function test_DomainSeparatorBindsChainAndContract() public {
        bytes32 sep = bridge.domainSeparator();
        assertTrue(sep != bytes32(0));
        vm.chainId(137);
        CrossChainBridge other = new CrossChainBridge(address(token), validator);
        assertTrue(other.domainSeparator() != sep);
    }

    function test_ZeroAddressRecipientRejected() public {
        bytes memory sig = _sign(alice, address(0), 10e18, 0);
        vm.expectRevert(CrossChainBridge.ZeroAddress.selector);
        bridge.processTransfer(alice, address(0), 10e18, 0, sig);
    }

    function test_NonceIsQueryable() public {
        assertEq(bridge.nonces(alice), 0);
        bytes memory sig = _sign(alice, bob, 1e18, 0);
        bridge.processTransfer(alice, bob, 1e18, 0, sig);
        assertEq(bridge.nonces(alice), 1);
    }
}
