// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/CrossChainBridge.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockERC20 public token;

    address public validator = vm.addr(1);
    address public user = vm.addr(2);
    address public recipient = vm.addr(3);
    address public nonOwner = vm.addr(4);

    uint256 public amount = 1000 ether;
    uint256 public targetChain = 137;

    function setUp() public {
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);

        token.mint(user, amount * 10);
        vm.prank(user);
        token.approve(address(bridge), amount * 10);
    }

    function test_Constructor() public {
        assertEq(address(bridge.bridgeToken()), address(token));
        assertEq(bridge.validator(), validator);
    }

    function test_Constructor_InvalidToken_Reverts() public {
        vm.expectRevert("Invalid token");
        new CrossChainBridge(address(0), validator);
    }

    function test_Constructor_InvalidValidator_Reverts() public {
        vm.expectRevert("Invalid validator");
        new CrossChainBridge(address(token), address(0));
    }

    function test_InitiateTransfer() public {
        vm.prank(user);
        bridge.initiateTransfer(amount, targetChain);

        assertEq(token.balanceOf(address(bridge)), amount);
        assertEq(bridge.getNonce(user), 1);
    }

    function test_InitiateTransfer_ZeroAmount_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        bridge.initiateTransfer(0, targetChain);
    }

    function test_ProcessTransfer() public {
        // Create signature
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            uint256(0),
            block.chainid,
            address(bridge)
        ));

        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            recipient,
            amount,
            uint256(0),
            block.chainid,
            address(bridge)
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validator, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Process transfer
        bridge.processTransfer(recipient, amount, 0, signature);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_ProcessTransfer_AlreadyProcessed_Reverts() public {
        // Create signature
        bytes32 transferHash = keccak256(abi.encodePacked(
            recipient,
            amount,
            uint256(0),
            block.chainid,
            address(bridge)
        ));

        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            recipient,
            amount,
            uint256(0),
            block.chainid,
            address(bridge)
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validator, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Process transfer
        bridge.processTransfer(recipient, amount, 0, signature);

        // Try to process again
        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, 0, signature);
    }

    function test_VerifySignature_InvalidSignature_Reverts() public {
        bytes memory invalidSignature = new bytes(65);
        vm.expectRevert("Invalid signature length");
        bridge.verifySignature(recipient, amount, 0, invalidSignature);
    }

    function test_GetNonce() public {
        assertEq(bridge.getNonce(user), 0);

        vm.prank(user);
        bridge.initiateTransfer(amount, targetChain);

        assertEq(bridge.getNonce(user), 1);
    }

    function test_GetPoolBalance() public {
        assertEq(bridge.getPoolBalance(), 0);

        vm.prank(user);
        bridge.initiateTransfer(amount, targetChain);

        assertEq(bridge.getPoolBalance(), amount);
    }
}
