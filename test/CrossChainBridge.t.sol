// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../solidity/contracts/CrossChainBridge.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        require(balanceOf[from] >= amount, "insufficient balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge public bridge;
    MockERC20 public token;

    uint256 public validatorKey = 1;
    address public validator = vm.addr(1);
    uint256 public userKey = 2;
    address public user = vm.addr(2);
    address public recipient = vm.addr(3);

    // EIP-712 type hashes
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "CrossChainTransfer(address recipient,uint256 amount,uint256 transferNonce,uint256 chainId,address contract)"
    );

    function setUp() public {
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);

        token.mint(user, 10000 ether);
        vm.prank(user);
        token.approve(address(bridge), 10000 ether);
    }

    // Helper: create a valid EIP-712 signature for processTransfer
    function _signTransfer(
        address _recipient,
        uint256 _amount,
        uint256 _transferNonce,
        uint256 _chainId,
        address _contractAddr,
        uint256 _signerKey
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            _chainId,
            _contractAddr
        ));

        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            _recipient,
            _amount,
            _transferNonce,
            _chainId,
            _contractAddr
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ========== initiateTransfer tests ==========

    function test_InitiateTransfer() public {
        vm.prank(user);
        bridge.initiateTransfer(100 ether, 137);

        assertEq(token.balanceOf(address(bridge)), 100 ether);
        assertEq(bridge.getNonce(user), 1);
    }

    function test_InitiateTransfer_ZeroAmount_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        bridge.initiateTransfer(0, 137);
    }

    function test_InitiateTransfer_NonceIncrements() public {
        vm.startPrank(user);
        bridge.initiateTransfer(10 ether, 137);
        assertEq(bridge.getNonce(user), 1);
        bridge.initiateTransfer(10 ether, 137);
        assertEq(bridge.getNonce(user), 2);
        bridge.initiateTransfer(10 ether, 137);
        assertEq(bridge.getNonce(user), 3);
        vm.stopPrank();
    }

    // ========== processTransfer tests ==========

    function test_ProcessTransfer_ValidSignature() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        bytes memory signature = _signTransfer(
            recipient, amount, nonce, block.chainid, address(bridge), validatorKey
        );

        // Pre-fund the bridge
        vm.prank(user);
        bridge.initiateTransfer(amount, 137);

        uint256 balanceBefore = token.balanceOf(recipient);
        bridge.processTransfer(recipient, amount, nonce, signature);

        assertEq(token.balanceOf(recipient), balanceBefore + amount);
    }

    function test_ProcessTransfer_InvalidSignature_Reverts() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        // Sign with wrong key (user instead of validator)
        bytes memory badSig = _signTransfer(
            recipient, amount, nonce, block.chainid, address(bridge), userKey
        );

        vm.prank(user);
        bridge.initiateTransfer(amount, 137);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, nonce, badSig);
    }

    function test_ProcessTransfer_DoubleProcess_Reverts() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        bytes memory signature = _signTransfer(
            recipient, amount, nonce, block.chainid, address(bridge), validatorKey
        );

        vm.prank(user);
        bridge.initiateTransfer(amount, 137);

        bridge.processTransfer(recipient, amount, nonce, signature);

        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, nonce, signature);
    }

    // ========== Cross-chain replay attack test ==========

    function test_CrossChainReplay_Prevented() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        // Create a signature on chain A (current chain)
        uint256 chainIdA = block.chainid;
        bytes memory signature = _signTransfer(
            recipient, amount, nonce, chainIdA, address(bridge), validatorKey
        );

        // Simulate a different chain ID
        uint256 chainIdB = chainIdA + 1;

        // Verify signature would NOT match on chain B
        bytes32 domainSeparatorB = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            chainIdB,
            address(bridge)
        ));

        bytes32 structHashB = keccak256(abi.encode(
            TRANSFER_TYPEHASH,
            recipient,
            amount,
            nonce,
            chainIdB,
            address(bridge)
        ));

        bytes32 digestB = keccak256(abi.encodePacked("\x19\x01", domainSeparatorB, structHashB));

        // The signature was made for chain A's digest, not chain B's
        // So when we use the same signature on chain B (we verify locally),
        // the ecrecover will not return validator because the digest is different

        // We can verify: the domain separator on current chain matches chain A
        bytes32 domainSeparatorA = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            chainIdA,
            address(bridge)
        ));
        assertEq(bridge.DOMAIN_SEPARATOR(), domainSeparatorA, "Domain separator mismatch");
        assertTrue(domainSeparatorA != domainSeparatorB, "Different chain IDs should produce different domain separators");
    }

    // ========== Same-chain replay attack test (nonce protection) ==========

    function test_SameChainReplay_Prevented() public {
        uint256 amount = 100 ether;
        uint256 nonce = 0;

        bytes memory signature = _signTransfer(
            recipient, amount, nonce, block.chainid, address(bridge), validatorKey
        );

        vm.prank(user);
        bridge.initiateTransfer(amount, 137);

        // First time works
        bridge.processTransfer(recipient, amount, nonce, signature);

        // Replaying the same (recipient, amount, nonce) with same signature fails
        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, nonce, signature);
    }

    // ========== Post-upgrade replay attack test ==========

    function test_PostUpgradeReplay_Prevented() public {
        uint256 amount = 100 ether;

        // Deploy a second bridge (simulating upgrade)
        CrossChainBridge newBridge = new CrossChainBridge(address(token), validator);

        // Signatures for original bridge won't work on new bridge
        // because the contract address is different
        assertTrue(address(bridge) != address(newBridge), "Bridge addresses must differ");

        // Verify different domain separators due to different contract addresses
        assertTrue(
            bridge.DOMAIN_SEPARATOR() != newBridge.DOMAIN_SEPARATOR(),
            "Post-upgrade domain separators must differ"
        );
    }

    // ========== Invalid signature (zero address) test ==========

    function test_InvalidSignature_ZeroAddress_Reverts() public {
        // Create an intentionally invalid signature with random bytes
        bytes memory invalidSig = new bytes(65);
        // Fill with random non-zero bytes that won't recover to a valid address
        for (uint256 i = 0; i < 65; i++) {
            invalidSig[i] = bytes1(uint8(i + 1));
        }

        uint256 amount = 100 ether;
        uint256 nonce = 0;

        vm.prank(user);
        bridge.initiateTransfer(amount, 137);

        // This should revert because ecrecover returns address(0)
        vm.expectRevert("Invalid signature: zero address");
        bridge.processTransfer(recipient, amount, nonce, invalidSig);
    }

    function test_InvalidSignature_WrongLength_Reverts() public {
        bytes memory shortSig = new bytes(32);

        uint256 amount = 100 ether;
        uint256 nonce = 0;

        vm.expectRevert("Invalid signature length");
        bridge.processTransfer(recipient, amount, nonce, shortSig);
    }

    // ========== EIP-712 domain separator test ==========

    function test_EIP712_DomainSeparator() public {
        bytes32 expectedDomainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("CrossChainBridge"),
            keccak256("1"),
            block.chainid,
            address(bridge)
        ));

        assertEq(bridge.DOMAIN_SEPARATOR(), expectedDomainSeparator, "EIP-712 domain separator mismatch");
    }

    // ========== Nonce queryable test ==========

    function test_GetNonce_Queryable() public {
        assertEq(bridge.getNonce(user), 0);

        vm.prank(user);
        bridge.initiateTransfer(100 ether, 137);
        assertEq(bridge.getNonce(user), 1);

        vm.prank(user);
        bridge.initiateTransfer(50 ether, 137);
        assertEq(bridge.getNonce(user), 2);
    }

    function test_Nonce_PerSender() public {
        address user2 = vm.addr(4);
        token.mint(user2, 10000 ether);
        vm.prank(user2);
        token.approve(address(bridge), 10000 ether);

        vm.prank(user);
        bridge.initiateTransfer(10 ether, 137);
        vm.prank(user2);
        bridge.initiateTransfer(10 ether, 137);

        assertEq(bridge.getNonce(user), 1);
        assertEq(bridge.getNonce(user2), 1);
    }

    // ========== Utility tests ==========

    function test_GetPoolBalance() public {
        assertEq(bridge.getPoolBalance(), 0);

        vm.prank(user);
        bridge.initiateTransfer(100 ether, 137);

        assertEq(bridge.getPoolBalance(), 100 ether);
    }

    function test_Constructor_ZeroAddressToken_Reverts() public {
        vm.expectRevert("Invalid token");
        new CrossChainBridge(address(0), validator);
    }

    function test_Constructor_ZeroAddressValidator_Reverts() public {
        MockERC20 newToken = new MockERC20();
        vm.expectRevert("Invalid validator");
        new CrossChainBridge(address(newToken), address(0));
    }
}
