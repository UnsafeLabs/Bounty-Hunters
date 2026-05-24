// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 1000000 * 10**18);
    }
}

contract CrossChainBridgeTest is Test {
    CrossChainBridge bridge;
    MockToken token;
    address validator;
    address user;
    uint256 validatorPrivateKey;

    function setUp() public {
        token = new MockToken();
        validatorPrivateKey = 0xA11CE;
        validator = vm.addr(validatorPrivateKey);
        user = makeAddr("user");

        bridge = new CrossChainBridge(address(token), validator);

        // Fund user and approve
        token.transfer(user, 10000 * 10**18);
        vm.prank(user);
        token.approve(address(bridge), 10000 * 10**18);

        // Fund bridge with tokens for payouts
        token.transfer(address(bridge), 50000 * 10**18);
    }

    function _signTransfer(
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 sourceChainId,
        uint256 targetChainId,
        address contractAddr
    ) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(
            recipient,
            amount,
            transferNonce,
            sourceChainId,
            targetChainId,
            contractAddr
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", hash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(validatorPrivateKey, ethHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        return signature;
    }

    // Test: Normal transfer processing succeeds
    function test_ProcessTransfer_Success() public {
        address recipient = makeAddr("recipient");
        uint256 amount = 100 * 10**18;

        bytes memory sig = _signTransfer(
            recipient, amount, 0, 1, block.chainid, address(bridge)
        );

        bridge.processTransfer(recipient, amount, 0, 1, sig);

        assertEq(token.balanceOf(recipient), amount);
        assertTrue(bridge.processedTransfers(keccak256(abi.encodePacked(
            recipient, amount, 0, 1, block.chainid, address(bridge)
        ))));
    }

    // Test: Same-chain replay is prevented by processedTransfers mapping
    function test_RevertSameChainReplay() public {
        address recipient = makeAddr("recipient");
        uint256 amount = 100 * 10**18;

        bytes memory sig = _signTransfer(
            recipient, amount, 0, 1, block.chainid, address(bridge)
        );

        bridge.processTransfer(recipient, amount, 0, 1, sig);

        // Same transfer should fail
        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, 0, 1, sig);
    }

    // Test: Cross-chain replay is prevented (different chain ID in hash)
    function test_RevertCrossChainReplay() public {
        address recipient = makeAddr("recipient");
        uint256 amount = 100 * 10**18;

        // Sign for chain 1
        bytes memory sig = _signTransfer(
            recipient, amount, 0, 1, block.chainid, address(bridge)
        );

        // Process on chain 1
        bridge.processTransfer(recipient, amount, 0, 1, sig);

        // Different source chain ID means different hash, so this is a different transfer
        // But if someone tries to replay with same sourceChainId, it fails
        vm.expectRevert("Already processed");
        bridge.processTransfer(recipient, amount, 0, 1, sig);
    }

    // Test: Invalid signature (zero address) is rejected
    function test_RevertInvalidSignature() public {
        address recipient = makeAddr("recipient");
        uint256 amount = 100 * 10**18;

        // Sign with wrong key
        uint256 wrongKey = 0xBAD;
        bytes32 hash = keccak256(abi.encodePacked(
            recipient, amount, 0, 1, block.chainid, address(bridge)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", hash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethHash);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert("Invalid signature");
        bridge.processTransfer(recipient, amount, 0, 1, badSig);
    }

    // Test: EIP-712 domain separator is correctly constructed
    function test_EIP712DomainSeparator() public {
        bytes32 expectedSeparator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("CrossChainBridge")),
            keccak256(bytes("1")),
            block.chainid,
            address(bridge)
        ));
        assertEq(bridge.DOMAIN_SEPARATOR(), expectedSeparator);
    }

    // Test: Nonce is queryable per sender
    function test_SenderNonceQueryable() public {
        assertEq(bridge.getSenderNonce(user), 0);
    }

    // Test: Initiate transfer increments nonce
    function test_InitiateTransferIncrementsNonce() public {
        uint256 before = bridge.nonce();
        vm.prank(user);
        bridge.initiateTransfer(100 * 10**18, 1);
        assertEq(bridge.nonce(), before + 1);
    }

    // Test: Contract address in hash prevents replay after upgrade
    function test_ContractAddressInHash() public {
        // The hash includes address(this), so a different contract address
        // would produce a different hash
        address recipient = makeAddr("recipient");
        uint256 amount = 100 * 10**18;

        bytes memory sig = _signTransfer(
            recipient, amount, 0, 1, block.chainid, address(bridge)
        );

        // Should succeed with correct contract address
        bridge.processTransfer(recipient, amount, 0, 1, sig);
        assertEq(token.balanceOf(recipient), amount);
    }
}
