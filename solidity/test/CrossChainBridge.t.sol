// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 1000000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockToken public token;

    uint256 public validatorPrivateKey = 0x1234;
    address public validator;

    address public user = address(0x1);

    function setUp() public {
        validator = vm.addr(validatorPrivateKey);
        token = new MockToken();
        bridge = new CrossChainBridge(address(token), validator);

        token.mint(address(bridge), 10000 ether);
        token.mint(user, 10000 ether);

        vm.startPrank(user);
        token.approve(address(bridge), type(uint256).max);
        vm.stopPrank();
    }

    function _getEIP712Hash(
        address recipient,
        uint256 amount,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                recipient,
                amount,
                nonce
            )
        );

        bytes32 DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(bridge)
            )
        );

        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function test_ValidTransfer() public {
        uint256 amount = 100 ether;
        uint256 nonce = bridge.nonces(user);

        bytes32 digest = _getEIP712Hash(user, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        uint256 balBefore = token.balanceOf(user);
        bridge.processTransfer(user, amount, nonce, signature);
        uint256 balAfter = token.balanceOf(user);

        assertEq(balAfter - balBefore, amount);
        assertEq(bridge.nonces(user), nonce + 1);
    }

    function test_SameChainReplay() public {
        uint256 amount = 100 ether;
        uint256 nonce = bridge.nonces(user);

        bytes32 digest = _getEIP712Hash(user, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        bridge.processTransfer(user, amount, nonce, signature);

        vm.expectRevert("Invalid nonce");
        bridge.processTransfer(user, amount, nonce, signature);
    }

    function test_CrossChainReplay() public {
        uint256 amount = 100 ether;
        uint256 nonce = bridge.nonces(user);

        // Sign message for chainId 1
        uint256 originalChainId = block.chainid;
        
        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                user,
                amount,
                nonce
            )
        );

        bytes32 domainSeparatorChain1 = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                1, // Fake chain ID
                address(bridge)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparatorChain1, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Try to process on current chainId (which is 31337)
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(user, amount, nonce, signature);
    }

    function test_PostUpgradeReplay() public {
        uint256 amount = 100 ether;
        uint256 nonce = bridge.nonces(user);

        bytes32 structHash = keccak256(
            abi.encode(
                bridge.TRANSFER_TYPEHASH(),
                user,
                amount,
                nonce
            )
        );

        // Sign for a different contract address (simulating old implementation proxy mismatch if implemented that way, 
        // or just different contract instance)
        bytes32 domainSeparatorOldContract = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CrossChainBridge")),
                keccak256(bytes("1")),
                block.chainid,
                address(0xdeadbeef)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparatorOldContract, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(user, amount, nonce, signature);
    }

    function test_InvalidSignature() public {
        uint256 amount = 100 ether;
        uint256 nonce = bridge.nonces(user);

        bytes32 digest = _getEIP712Hash(user, amount, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, digest);
        
        // Corrupt signature (e.g., wrong v, resulting in ecrecover 0 or wrong address)
        bytes memory signature = abi.encodePacked(r, s, uint8(v + 1));

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(user, amount, nonce, signature);
    }
}
