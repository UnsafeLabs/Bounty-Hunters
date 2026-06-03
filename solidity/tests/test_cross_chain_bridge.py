from pathlib import Path

import pytest
from eth_abi import encode
from eth_account import Account
from eth_keys import keys
from eth_tester import EthereumTester, PyEVMBackend
from eth_utils import keccak, to_bytes, to_checksum_address
from hexbytes import HexBytes
from solcx import compile_standard, install_solc
from web3 import EthereumTesterProvider, Web3


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "solidity" / "contracts" / "CrossChainBridge.sol"

TOKEN_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TestToken {
    string public name = "Bridge Token";
    string public symbol = "BRG";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply) {
        balanceOf[msg.sender] = supply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
"""

IERC20_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
"""

DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
TRANSFER_TYPE = "BridgeTransfer(address sourceSender,address recipient,uint256 amount,uint256 nonce)"


@pytest.fixture(scope="session")
def compiled_contracts():
    install_solc("0.8.20")
    output = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                "CrossChainBridge.sol": {"content": CONTRACT.read_text(encoding="utf-8")},
                "@openzeppelin/contracts/token/ERC20/IERC20.sol": {"content": IERC20_SOURCE},
                "TestToken.sol": {"content": TOKEN_SOURCE},
            },
            "settings": {
                "evmVersion": "paris",
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object"]}},
            },
        },
        solc_version="0.8.20",
    )
    return output["contracts"]


@pytest.fixture()
def bridge_chain(compiled_contracts):
    tester = EthereumTester(PyEVMBackend())
    w3 = Web3(EthereumTesterProvider(tester))
    validator_account = Account.create()

    token_def = compiled_contracts["TestToken.sol"]["TestToken"]
    bridge_def = compiled_contracts["CrossChainBridge.sol"]["CrossChainBridge"]

    token_contract = w3.eth.contract(
        abi=token_def["abi"],
        bytecode=token_def["evm"]["bytecode"]["object"],
    )
    token_tx = token_contract.constructor(10**24).transact({"from": w3.eth.accounts[0]})
    token_address = w3.eth.wait_for_transaction_receipt(token_tx).contractAddress

    bridge_contract = w3.eth.contract(
        abi=bridge_def["abi"],
        bytecode=bridge_def["evm"]["bytecode"]["object"],
    )
    bridge_tx = bridge_contract.constructor(
        token_address,
        validator_account.address,
    ).transact({"from": w3.eth.accounts[0]})
    bridge_address = w3.eth.wait_for_transaction_receipt(bridge_tx).contractAddress

    token = w3.eth.contract(address=token_address, abi=token_def["abi"])
    bridge = w3.eth.contract(address=bridge_address, abi=bridge_def["abi"])
    token.functions.transfer(bridge_address, 1_000_000).transact({"from": w3.eth.accounts[0]})

    return {
        "w3": w3,
        "token": token,
        "bridge": bridge,
        "bridge_def": bridge_def,
        "validator": validator_account,
    }


def eip712_digest(chain_id, bridge_address, source_sender, recipient, amount, nonce):
    domain_separator = keccak(
        encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                keccak(text=DOMAIN_TYPE),
                keccak(text="CrossChainBridge"),
                keccak(text="1"),
                chain_id,
                to_checksum_address(bridge_address),
            ],
        )
    )
    struct_hash = keccak(
        encode(
            ["bytes32", "address", "address", "uint256", "uint256"],
            [
                keccak(text=TRANSFER_TYPE),
                to_checksum_address(source_sender),
                to_checksum_address(recipient),
                amount,
                nonce,
            ],
        )
    )
    return keccak(b"\x19\x01" + domain_separator + struct_hash)


def sign_hash(private_key, digest):
    sig = keys.PrivateKey(to_bytes(private_key)).sign_msg_hash(HexBytes(digest))
    return sig.r.to_bytes(32, "big") + sig.s.to_bytes(32, "big") + bytes([sig.v + 27])


def test_valid_eip712_transfer_advances_source_sender_nonce(bridge_chain):
    w3 = bridge_chain["w3"]
    token = bridge_chain["token"]
    bridge = bridge_chain["bridge"]
    source_sender = w3.eth.accounts[2]
    recipient = w3.eth.accounts[1]
    amount = 1234
    transfer_nonce = bridge.functions.nonces(source_sender).call()
    digest = bridge.functions.getTransferHash(source_sender, recipient, amount, transfer_nonce).call()
    signature = sign_hash(bridge_chain["validator"].key, digest)

    assert bridge.functions.verifySignature(digest, signature).call() is True

    bridge.functions.processTransfer(
        source_sender, recipient, amount, transfer_nonce, signature
    ).transact({"from": w3.eth.accounts[0]})

    assert token.functions.balanceOf(recipient).call() == amount
    assert bridge.functions.nonces(source_sender).call() == transfer_nonce + 1


def test_cross_chain_replay_signature_is_rejected(bridge_chain):
    w3 = bridge_chain["w3"]
    bridge = bridge_chain["bridge"]
    source_sender = w3.eth.accounts[2]
    recipient = w3.eth.accounts[1]
    wrong_chain_digest = eip712_digest(
        w3.eth.chain_id + 1,
        bridge.address,
        source_sender,
        recipient,
        100,
        0,
    )
    signature = sign_hash(bridge_chain["validator"].key, wrong_chain_digest)

    assert bridge.functions.verifySignature(wrong_chain_digest, signature).call() is True

    with pytest.raises(Exception, match="Invalid signature"):
        bridge.functions.processTransfer(source_sender, recipient, 100, 0, signature).transact(
            {"from": w3.eth.accounts[0]}
        )


def test_same_chain_replay_is_blocked_by_sender_nonce(bridge_chain):
    w3 = bridge_chain["w3"]
    bridge = bridge_chain["bridge"]
    source_sender = w3.eth.accounts[2]
    recipient = w3.eth.accounts[1]
    digest = bridge.functions.getTransferHash(source_sender, recipient, 100, 0).call()
    signature = sign_hash(bridge_chain["validator"].key, digest)

    bridge.functions.processTransfer(source_sender, recipient, 100, 0, signature).transact(
        {"from": w3.eth.accounts[0]}
    )

    with pytest.raises(Exception, match="Invalid nonce|Already processed"):
        bridge.functions.processTransfer(source_sender, recipient, 100, 0, signature).transact(
            {"from": w3.eth.accounts[0]}
        )


def test_redeployed_bridge_rejects_old_contract_signature(compiled_contracts, bridge_chain):
    w3 = bridge_chain["w3"]
    token = bridge_chain["token"]
    first_bridge = bridge_chain["bridge"]
    source_sender = w3.eth.accounts[2]
    recipient = w3.eth.accounts[1]
    digest = first_bridge.functions.getTransferHash(source_sender, recipient, 100, 0).call()
    signature = sign_hash(bridge_chain["validator"].key, digest)

    bridge_def = compiled_contracts["CrossChainBridge.sol"]["CrossChainBridge"]
    factory = w3.eth.contract(
        abi=bridge_def["abi"],
        bytecode=bridge_def["evm"]["bytecode"]["object"],
    )
    second_tx = factory.constructor(
        token.address,
        bridge_chain["validator"].address,
    ).transact({"from": w3.eth.accounts[0]})
    second_address = w3.eth.wait_for_transaction_receipt(second_tx).contractAddress
    second_bridge = w3.eth.contract(address=second_address, abi=bridge_def["abi"])
    token.functions.transfer(second_address, 1_000_000).transact({"from": w3.eth.accounts[0]})

    with pytest.raises(Exception, match="Invalid signature"):
        second_bridge.functions.processTransfer(source_sender, recipient, 100, 0, signature).transact(
            {"from": w3.eth.accounts[0]}
        )


def test_invalid_ecrecover_zero_address_signature_is_rejected(bridge_chain):
    w3 = bridge_chain["w3"]
    bridge = bridge_chain["bridge"]
    source_sender = w3.eth.accounts[2]
    recipient = w3.eth.accounts[1]
    digest = bridge.functions.getTransferHash(source_sender, recipient, 100, 0).call()
    invalid_signature = bytes(65)

    assert bridge.functions.verifySignature(digest, invalid_signature).call() is False

    with pytest.raises(Exception, match="Invalid signature"):
        bridge.functions.processTransfer(source_sender, recipient, 100, 0, invalid_signature).transact(
            {"from": w3.eth.accounts[0]}
        )


def test_domain_separator_matches_eip712_chain_and_contract(bridge_chain):
    w3 = bridge_chain["w3"]
    bridge = bridge_chain["bridge"]
    expected = eip712_digest(
        w3.eth.chain_id,
        bridge.address,
        w3.eth.accounts[2],
        w3.eth.accounts[1],
        100,
        0,
    )

    assert bridge.functions.DOMAIN_SEPARATOR().call() == keccak(
        encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                keccak(text=DOMAIN_TYPE),
                keccak(text="CrossChainBridge"),
                keccak(text="1"),
                w3.eth.chain_id,
                to_checksum_address(bridge.address),
            ],
        )
    )
    assert bridge.functions.getTransferHash(w3.eth.accounts[2], w3.eth.accounts[1], 100, 0).call() == expected


def test_public_nonce_mapping_is_available_for_frontends():
    source = CONTRACT.read_text(encoding="utf-8")

    assert "mapping(address => uint256) public nonces" in source
