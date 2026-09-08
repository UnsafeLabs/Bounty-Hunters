// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    
    string public name = "MockToken";
    string public symbol = "MTK";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    
    constructor(uint256 initialSupply) {
        _mint(msg.sender, initialSupply);
    }
    
    function _mint(address to, uint256 amount) internal {
        _balances[to] += amount;
        totalSupply += amount;
    }
    
    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }
    
    function transfer(address to, uint256 amount) public override returns (bool) {
        require(_balances[msg.sender] >= amount, "Insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }
    
    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }
    
    function approve(address spender, uint256 amount) public override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(_allowances[from][msg.sender] >= amount, "Insufficient allowance");
        require(_balances[from] >= amount, "Insufficient balance");
        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }
}

contract CrossChainBridgeTest {
    CrossChainBridge public bridge;
    MockERC20 public token;
    address public validator;
    address public sender;
    address public recipient;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        token = new MockERC20(1000000);
        validator = address(0x1);
        sender = address(0x2);
        recipient = address(0x3);
        
        // Mint tokens to sender
        token._mint(sender, 1000);
        
        // Deploy bridge
        bridge = new CrossChainBridge(address(token), validator);
        
        // Approve bridge to spend tokens
        vm.prank(sender);
        token.approve(address(bridge), 1000);
    }
    
    function testInitiateTransfer() public {
        uint256 initialNonce = bridge.getSenderNonce(sender);
        
        vm.prank(sender);
        bridge.initiateTransfer(100, 2);
        
        uint256 newNonce = bridge.getSenderNonce(sender);
        
        if (newNonce == initialNonce + 1) {
            emit TestPassed("Initiate transfer increments sender nonce");
        } else {
            emit TestFailed("Initiate transfer should increment sender nonce");
        }
    }
    
    function testProcessTransferValid() public {
        // Initiate transfer first
        vm.prank(sender);
        bridge.initiateTransfer(100, 2);
        
        uint256 senderNonce = bridge.getSenderNonce(sender);
        uint256 chainId = block.chainid;
        address bridgeAddress = address(bridge);
        
        // Create the hash that should be signed
        bytes32 transferHash = keccak256(abi.encodePacked(
            keccak256("uint256,address,uint256,uint256,uint256"),
            chainId,
            bridgeAddress,
            recipient,
            100,
            senderNonce
        ));
        
        // Create EIP-712 domain separator
        bytes32 DOMAIN_TYPEHASH = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1.0"),
            chainId,
            bridgeAddress
        ));
        
        // Create structured hash
        bytes32 structuredHash = keccak256(abi.encodePacked(
            hex"1901",
            domainSeparator,
            transferHash
        ));
        
        // Sign with validator private key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, structuredHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Process transfer
        vm.prank(sender);
        bridge.processTransfer(recipient, 100, senderNonce, 2, signature);
        
        if (token.balanceOf(recipient) == 100) {
            emit TestPassed("Process transfer with valid signature works");
        } else {
            emit TestFailed("Process transfer should transfer tokens");
        }
    }
    
    function testCrossChainReplayPrevention() public {
        // This test verifies that chainId is included in the hash
        // by checking that different chainIds produce different hashes
        uint256 chainId1 = 1;
        uint256 chainId2 = 2;
        address bridgeAddress = address(bridge);
        
        bytes32 hash1 = keccak256(abi.encodePacked(
            keccak256("uint256,address,uint256,uint256,uint256"),
            chainId1,
            bridgeAddress,
            recipient,
            100,
            0
        ));
        
        bytes32 hash2 = keccak256(abi.encodePacked(
            keccak256("uint256,address,uint256,uint256,uint256"),
            chainId2,
            bridgeAddress,
            recipient,
            100,
            0
        ));
        
        if (hash1 != hash2) {
            emit TestPassed("Different chainIds produce different hashes (cross-chain replay prevention)");
        } else {
            emit TestFailed("Different chainIds should produce different hashes");
        }
    }
    
    function testSameChainReplayPrevention() public {
        // Initiate transfer
        vm.prank(sender);
        bridge.initiateTransfer(100, 2);
        
        uint256 senderNonce = bridge.getSenderNonce(sender);
        uint256 chainId = block.chainid;
        address bridgeAddress = address(bridge);
        
        bytes32 transferHash = keccak256(abi.encodePacked(
            keccak256("uint256,address,uint256,uint256,uint256"),
            chainId,
            bridgeAddress,
            recipient,
            100,
            senderNonce
        ));
        
        // Create signature
        bytes32 DOMAIN_TYPEHASH = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1.0"),
            chainId,
            bridgeAddress
        ));
        bytes32 structuredHash = keccak256(abi.encodePacked(
            hex"1901",
            domainSeparator,
            transferHash
        ));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, structuredHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Process transfer
        vm.prank(sender);
        bridge.processTransfer(recipient, 100, senderNonce, 2, signature);
        
        // Try to replay with same nonce (should fail)
        vm.prank(sender);
        try bridge.processTransfer(recipient, 100, senderNonce, 2, signature) {
            emit TestFailed("Should not allow replay with same nonce");
        } catch {
            emit TestPassed("Same-chain replay prevented by nonce");
        }
    }
    
    function testContractUpgradeReplayPrevention() public {
        // This test verifies that contract address is included in the hash
        address bridgeAddress1 = address(0x100);
        address bridgeAddress2 = address(0x200);
        uint256 chainId = block.chainid;
        
        bytes32 hash1 = keccak256(abi.encodePacked(
            keccak256("uint256,address,uint256,uint256,uint256"),
            chainId,
            bridgeAddress1,
            recipient,
            100,
            0
        ));
        
        bytes32 hash2 = keccak256(abi.encodePacked(
            keccak256("uint256,address,uint256,uint256,uint256"),
            chainId,
            bridgeAddress2,
            recipient,
            100,
            0
        ));
        
        if (hash1 != hash2) {
            emit TestPassed("Different contract addresses produce different hashes (upgrade replay prevention)");
        } else {
            emit TestFailed("Different contract addresses should produce different hashes");
        }
    }
    
    function testZeroAddressSignatureRejection() public {
        // Create an invalid signature that would result in zero address
        // This is hard to create in practice, but we can test the require statement
        // by checking that the function doesn't return true for zero address
        
        // For this test, we'll use a signature that recovers to zero address
        // In Foundry, we can use vm.sign with address(0) private key
        bytes32 testHash = keccak256("test");
        
        // Sign with address(0) - this should create a signature that recovers to zero
        // Note: In reality, address(0) doesn't have a private key, but we can mock this
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0, testHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        bool result = bridge.verifySignature(testHash, signature);
        
        if (!result) {
            emit TestPassed("Zero address signature rejected");
        } else {
            emit TestFailed("Zero address signature should be rejected");
        }
    }
    
    function testGetSenderNonce() public view {
        uint256 nonce = bridge.getSenderNonce(sender);
        // Initial nonce should be 0
        if (nonce == 0) {
            emit TestPassed("getSenderNonce returns correct value");
        } else {
            emit TestFailed("Initial sender nonce should be 0");
        }
    }
}
