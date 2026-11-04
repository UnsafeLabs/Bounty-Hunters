// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/CrossChainBridge.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function chainId(uint256 newChainId) external;
}

contract MockERC20 is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: transfer amount exceeds balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount, "ERC20: transfer amount exceeds balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract CrossChainBridgeTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    CrossChainBridge bridge;
    MockERC20 token;
    address validator;
    uint256 validatorPrivateKey = 0xA11CE;

    address alice = address(0x1111);
    address bob = address(0x2222);

    function setUp() public {
        validator = vm.addr(validatorPrivateKey);
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);
        token.mint(address(bridge), 1_000_000 ether);
    }

    function _signTransfer(
        CrossChainBridge bridgeInstance,
        address sender,
        address recipient,
        uint256 amount,
        uint256 transferNonce,
        uint256 pk
    ) internal returns (bytes memory) {
        bytes32 digest = bridgeInstance.getTransferDigest(sender, recipient, amount, transferNonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_HappyPathTransfer() public {
        setUp();
        uint256 amount = 100 ether;
        uint256 transferNonce = bridge.nonces(alice);
        require(transferNonce == 0, "Initial nonce not zero");

        bytes memory sig = _signTransfer(bridge, alice, bob, amount, transferNonce, validatorPrivateKey);

        bridge.processTransfer(alice, bob, amount, transferNonce, sig);

        require(token.balanceOf(bob) == amount, "Recipient balance mismatch");
        require(bridge.nonces(alice) == 1, "Nonce not incremented");
        bytes32 digest = bridge.getTransferDigest(alice, bob, amount, transferNonce);
        require(bridge.processedTransfers(digest), "Transfer not marked processed");
    }

    function test_CrossChainReplayRejected() public {
        setUp();
        uint256 amount = 50 ether;
        bytes memory sig = _signTransfer(bridge, alice, bob, amount, 0, validatorPrivateKey);

        bridge.processTransfer(alice, bob, amount, 0, sig);
        require(token.balanceOf(bob) == amount, "First transfer failed");

        // Switch to Polygon chain ID
        vm.chainId(137);
        CrossChainBridge polygonBridge = new CrossChainBridge(address(token), validator);
        token.mint(address(polygonBridge), 1_000_000 ether);

        bool replayFailed = false;
        try polygonBridge.processTransfer(alice, bob, amount, 0, sig) {
            replayFailed = false;
        } catch {
            replayFailed = true;
        }
        require(replayFailed, "Cross-chain replay should have reverted");
    }

    function test_SameChainReplayRejectedByNonce() public {
        setUp();
        uint256 amount = 50 ether;
        bytes memory sig = _signTransfer(bridge, alice, bob, amount, 0, validatorPrivateKey);

        bridge.processTransfer(alice, bob, amount, 0, sig);

        bool replayFailed = false;
        try bridge.processTransfer(alice, bob, amount, 0, sig) {
            replayFailed = false;
        } catch {
            replayFailed = true;
        }
        require(replayFailed, "Same-chain replay should have reverted");
    }

    function test_PostUpgradeOrRedeployReplayRejectedByContractAddress() public {
        setUp();
        uint256 amount = 75 ether;
        bytes memory sig = _signTransfer(bridge, alice, bob, amount, 0, validatorPrivateKey);

        CrossChainBridge upgradedBridge = new CrossChainBridge(address(token), validator);
        token.mint(address(upgradedBridge), 1_000_000 ether);

        bool replayFailed = false;
        try upgradedBridge.processTransfer(alice, bob, amount, 0, sig) {
            replayFailed = false;
        } catch {
            replayFailed = true;
        }
        require(replayFailed, "Post-upgrade replay should have reverted");
    }

    function test_InvalidSignatureZeroAddressRejected() public {
        setUp();
        uint256 amount = 10 ether;
        bytes memory malformedSig = new bytes(65);

        bool rejected = false;
        try bridge.processTransfer(alice, bob, amount, 0, malformedSig) {
            rejected = false;
        } catch {
            rejected = true;
        }
        require(rejected, "Zero address signature should be rejected");
    }

    function test_UnauthorizedSignerRejected() public {
        setUp();
        uint256 rogueKey = 0xBAD;
        uint256 amount = 25 ether;
        bytes memory rogueSig = _signTransfer(bridge, alice, bob, amount, 0, rogueKey);

        bool rejected = false;
        try bridge.processTransfer(alice, bob, amount, 0, rogueSig) {
            rejected = false;
        } catch {
            rejected = true;
        }
        require(rejected, "Rogue signature should be rejected");
    }

    function test_NoncesQueryablePerSender() public {
        setUp();
        require(bridge.nonces(alice) == 0, "Alice nonce not 0");
        require(bridge.nonces(bob) == 0, "Bob nonce not 0");

        bytes memory sigAlice = _signTransfer(bridge, alice, bob, 10 ether, 0, validatorPrivateKey);
        bridge.processTransfer(alice, bob, 10 ether, 0, sigAlice);

        require(bridge.nonces(alice) == 1, "Alice nonce not 1");
        require(bridge.nonces(bob) == 0, "Bob nonce not 0");

        bytes memory sigBob = _signTransfer(bridge, bob, alice, 5 ether, 0, validatorPrivateKey);
        bridge.processTransfer(bob, alice, 5 ether, 0, sigBob);

        require(bridge.nonces(alice) == 1, "Alice nonce not 1");
        require(bridge.nonces(bob) == 1, "Bob nonce not 1");
    }

    function test_DomainSeparatorBindsChainIdAndAddress() public {
        setUp();
        bytes32 dsOriginal = bridge.domainSeparator();
        require(dsOriginal != bytes32(0), "Domain separator is zero");

        CrossChainBridge anotherBridge = new CrossChainBridge(address(token), validator);
        require(anotherBridge.domainSeparator() != dsOriginal, "Different address must yield different domain separator");

        vm.chainId(42161);
        require(bridge.domainSeparator() != dsOriginal, "Different chainId must yield different domain separator");
    }
}
