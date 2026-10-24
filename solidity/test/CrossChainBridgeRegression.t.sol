// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/CrossChainBridge.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function chainId(uint256 newChainId) external;
}

contract MockERC20 is IERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract CrossChainBridgeTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant VALIDATOR_KEY = 0xA11CE;
    address private validator;
    address private sender = address(0xBEEF);
    address private recipient = address(0xCAFE);
    MockERC20 private token;
    CrossChainBridge private bridge;

    function setUp() public {
        validator = vm.addr(VALIDATOR_KEY);
        token = new MockERC20();
        bridge = new CrossChainBridge(address(token), validator);
        token.mint(address(bridge), 1_000_000);
    }

    function _signature(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VALIDATOR_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function testEIP712TransferConsumesSenderNonce() public {
        setUp();
        bytes32 digest = bridge.getTransferDigest(sender, recipient, 100, 0);
        bridge.processTransfer(sender, recipient, 100, 0, _signature(digest));
        require(token.balanceOf(recipient) == 100, "recipient not paid");
        require(bridge.nonces(sender) == 1, "nonce not consumed");

        bool replayRejected;
        try bridge.processTransfer(sender, recipient, 100, 0, _signature(digest)) {
            replayRejected = false;
        } catch {
            replayRejected = true;
        }
        require(replayRejected, "same nonce replayed");
    }

    function testDomainChangesWithChainId() public {
        setUp();
        bytes32 beforeChainChange = bridge.getTransferDigest(sender, recipient, 1, 0);
        vm.chainId(2);
        bytes32 afterChainChange = bridge.getTransferDigest(sender, recipient, 1, 0);
        require(beforeChainChange != afterChainChange, "chain id not bound");
    }

    function testDomainChangesWithVerifyingContract() public {
        setUp();
        CrossChainBridge second = new CrossChainBridge(address(token), validator);
        bytes32 first = bridge.getTransferDigest(sender, recipient, 1, 0);
        bytes32 secondDigest = second.getTransferDigest(sender, recipient, 1, 0);
        require(first != secondDigest, "contract address not bound");
    }

    function testInvalidZeroSignatureRejected() public {
        setUp();
        bytes memory invalid = new bytes(65);
        bool rejected;
        try bridge.processTransfer(sender, recipient, 1, 0, invalid) {
            rejected = false;
        } catch {
            rejected = true;
        }
        require(rejected, "zero signature accepted");
    }
}
