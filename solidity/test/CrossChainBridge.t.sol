// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge bridge;
    MockERC20 token;
    
    uint256 validatorPrivateKey = 0xA11CE;
    address validator;

    function setUp() public {
        validator = vm.addr(validatorPrivateKey);
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);
        token.mint(address(bridge), 1000000);
    }

    function _getDomainSeparator(address bridgeAddr, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            chainId,
            bridgeAddr
        ));
    }

    function _getStructHash(address recipient, uint256 amount, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("Transfer(address recipient,uint256 amount,uint256 nonce)"),
            recipient,
            amount,
            nonce
        ));
    }

    function _signTransfer(
        uint256 pk,
        address bridgeAddr,
        uint256 chainId,
        address recipient,
        uint256 amount,
        uint256 nonce
    ) internal pure returns (bytes memory) {
        bytes32 domainSeparator = _getDomainSeparator(bridgeAddr, chainId);
        bytes32 structHash = _getStructHash(recipient, amount, nonce);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_EIP712Verification() public {
        address recipient = address(0x123);
        uint256 amount = 100;
        uint256 nonce = 0;

        bytes memory sig = _signTransfer(validatorPrivateKey, address(bridge), block.chainid, recipient, amount, nonce);
        bridge.processTransfer(recipient, amount, nonce, sig);

        assertEq(token.balanceOf(recipient), amount);
    }

    function test_SameChainReplay() public {
        address recipient = address(0x123);
        uint256 amount = 100;
        uint256 nonce = 0;

        bytes memory sig = _signTransfer(validatorPrivateKey, address(bridge), block.chainid, recipient, amount, nonce);
        bridge.processTransfer(recipient, amount, nonce, sig);

        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, nonce, sig);
    }

    function test_CrossChainReplay() public {
        address recipient = address(0x123);
        uint256 amount = 100;
        uint256 nonce = 0;

        // Sign for chainId 999
        bytes memory sig = _signTransfer(validatorPrivateKey, address(bridge), 999, recipient, amount, nonce);
        
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, nonce, sig);
    }

    function test_PostUpgradeReplay() public {
        address recipient = address(0x123);
        uint256 amount = 100;
        uint256 nonce = 0;

        // Sign for a different contract address
        bytes memory sig = _signTransfer(validatorPrivateKey, address(0x999), block.chainid, recipient, amount, nonce);
        
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, nonce, sig);
    }

    function test_InvalidSignatureZeroAddress() public {
        address recipient = address(0x123);
        uint256 amount = 100;
        uint256 nonce = 0;

        // Create a completely invalid signature (v=27, r=0, s=0 might recover to 0)
        bytes memory sig = new bytes(65);
        sig[64] = bytes1(uint8(27)); // v

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, nonce, sig);
    }
}
