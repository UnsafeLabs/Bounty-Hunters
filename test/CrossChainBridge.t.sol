// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/CrossChainBridge.sol";

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockERC20 public token;
    
    address public owner = address(1);
    address public validator = address(2);
    address public user1 = address(3);
    address public user2 = address(4);
    
    uint256 public constant INITIAL_BALANCE = 1000 ether;
    uint256 public constant TRANSFER_AMOUNT = 100 ether;
    uint256 public constant TARGET_CHAIN = 2;
    
    function setUp() public {
        token = new MockERC20("Test Token", "TT", INITIAL_BALANCE);
        
        vm.prank(owner);
        bridge = new CrossChainBridge(address(token), validator);
        
        // Transfer tokens to bridge
        token.transfer(address(bridge), INITIAL_BALANCE / 2);
        
        // Transfer tokens to users
        token.transfer(user1, INITIAL_BALANCE / 4);
        token.transfer(user2, INITIAL_BALANCE / 4);
    }
    
    // Test: Cross-chain replay prevention
    function test_CrossChainReplayPrevention() public {
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        // Create signature for transfer
        uint256 nonce = bridge.getNonce(user1) - 1;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            user2,
            TRANSFER_AMOUNT,
            nonce,
            block.chainid,
            address(bridge)
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validator, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Process transfer on current chain
        vm.prank(user1);
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
        
        // Try to replay on different chain (should fail)
        vm.chainId(999);
        vm.prank(user1);
        vm.expectRevert("Already processed");
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
    }
    
    // Test: Same-chain replay prevention
    function test_SameChainReplayPrevention() public {
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        // Create signature
        uint256 nonce = bridge.getNonce(user1) - 1;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            user2,
            TRANSFER_AMOUNT,
            nonce,
            block.chainid,
            address(bridge)
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validator, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Process transfer
        vm.prank(user1);
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
        
        // Try to replay on same chain (should fail)
        vm.prank(user1);
        vm.expectRevert("Already processed");
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
    }
    
    // Test: Invalid signature (zero address)
    function test_InvalidSignatureZeroAddress() public {
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        // Create invalid signature (wrong validator)
        uint256 nonce = bridge.getNonce(user1) - 1;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            user2,
            TRANSFER_AMOUNT,
            nonce,
            block.chainid,
            address(bridge)
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(address(999), digest); // Wrong validator
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Should revert with invalid signature
        vm.prank(user1);
        vm.expectRevert("Invalid signature");
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
    }
    
    // Test: EIP-712 verification
    function test_EIP712Verification() public {
        // Verify domain separator
        bytes32 expectedDomainSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(bridge)
        ));
        
        assertEq(bridge.DOMAIN_SEPARATOR(), expectedDomainSeparator, "Domain separator should match");
    }
    
    // Test: Nonce is queryable
    function test_NonceQueryable() public {
        assertEq(bridge.getNonce(user1), 0, "Initial nonce should be 0");
        
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        assertEq(bridge.getNonce(user1), 1, "Nonce should increment");
    }
    
    // Test: Pool balance
    function test_PoolBalance() public {
        uint256 expectedBalance = INITIAL_BALANCE / 2;
        assertEq(bridge.getPoolBalance(), expectedBalance, "Pool balance should match");
    }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply;
        balanceOf[msg.sender] = _initialSupply;
    }
    
    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    
    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

    // Test: Ecrecover zero address
    function test_EcrecoverZeroAddress() public {
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        // Create signature that will cause ecrecover to return address(0)
        uint256 nonce = bridge.getNonce(user1) - 1;
        
        // Use invalid signature (all zeros)
        bytes memory invalidSignature = new bytes(65);
        
        // Should revert with invalid signature
        vm.prank(user1);
        vm.expectRevert("Invalid signature: zero address");
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, invalidSignature);
    }
    
    // Test: Post-upgrade replay prevention
    function test_PostUpgradeReplayPrevention() public {
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        // Create signature
        uint256 nonce = bridge.getNonce(user1) - 1;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            user2,
            TRANSFER_AMOUNT,
            nonce,
            block.chainid,
            address(bridge)
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validator, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        // Process transfer
        vm.prank(user1);
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
        
        // Deploy new bridge (simulating upgrade)
        vm.prank(owner);
        CrossChainBridge newBridge = new CrossChainBridge(address(token), validator);
        
        // Try to replay on new bridge (should fail because address(this) changed)
        vm.prank(user1);
        vm.expectRevert("Already processed");
        newBridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
    }
    
    // Test: Process transfer when paused
    function test_ProcessTransferWhenPaused() public {
        // Pause the bridge
        vm.prank(owner);
        bridge.pause();
        
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        vm.expectRevert("Pausable: paused");
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
    }
    
    // Test: Invalid signature length
    function test_InvalidSigLength() public {
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        uint256 nonce = bridge.getNonce(user1) - 1;
        
        // Create signature with wrong length
        bytes memory shortSignature = new bytes(32);
        
        // Should revert with invalid signature length
        vm.prank(user1);
        vm.expectRevert("Invalid signature length");
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, shortSignature);
    }
    
    // Test: Constructor validation
    function test_ConstructorValidation() public {
        // Zero address token
        vm.prank(owner);
        vm.expectRevert("Invalid token");
        new CrossChainBridge(address(0), validator);
        
        // Zero address validator
        vm.prank(owner);
        vm.expectRevert("Invalid validator");
        new CrossChainBridge(address(token), address(0));
    }
    
    // Test: Non-owner access control
    function test_NonOwnerAccess() public {
        // Non-owner pause
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        bridge.pause();
        
        // Non-owner unpause
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        bridge.unpause();
    }
    
    // Test: Successful transfer end-to-end
    function test_SuccessfulTransfer() public {
        // Initiate transfer
        vm.prank(user1);
        token.approve(address(bridge), TRANSFER_AMOUNT);
        
        vm.prank(user1);
        bridge.initiateTransfer(TRANSFER_AMOUNT, TARGET_CHAIN);
        
        // Create signature
        uint256 nonce = bridge.getNonce(user1) - 1;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"),
            user2,
            TRANSFER_AMOUNT,
            nonce,
            block.chainid,
            address(bridge)
        ));
        
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bridge.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validator, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        uint256 user2BalanceBefore = token.balanceOf(user2);
        
        // Process transfer
        vm.prank(user1);
        bridge.processTransfer(user2, TRANSFER_AMOUNT, nonce, signature);
        
        // Verify recipient received tokens
        assertEq(token.balanceOf(user2), user2BalanceBefore + TRANSFER_AMOUNT, "Recipient should receive tokens");
    }
}
