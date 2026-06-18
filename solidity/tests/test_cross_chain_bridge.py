from pathlib import Path

import pytest
from eth_account import Account
from eth_keys import keys
from eth_tester.exceptions import TransactionFailed
from eth_utils import to_bytes
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
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply) {
        balanceOf[msg.sender] = supply;
        totalSupply = supply;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
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


@pytest.fixture(scope="session")
def compiled_contracts():
    install_solc("0.8.20")
    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                "CrossChainBridge.sol": {"content": CONTRACT.read_text(encoding="utf-8")},
                "@openzeppelin/contracts/token/ERC20/IERC20.sol": {"content": IERC20_SOURCE},
                "TestToken.sol": {"content": TOKEN_SOURCE},
            },
            "settings": {
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object"]}},
            },
        },
        solc_version="0.8.20",
    )
    return compiled["contracts"]


@pytest.fixture()
def w3():
    return Web3(EthereumTesterProvider())


def deploy(w3, contract_def, args=(), sender=None):
    sender = sender or w3.eth.accounts[0]
    contract = w3.eth.contract(
        abi=contract_def["abi"],
        bytecode=contract_def["evm"]["bytecode"]["object"],
    )
    tx_hash = contract.constructor(*args).transact({"from": sender})
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    return w3.eth.contract(address=receipt.contractAddress, abi=contract_def["abi"])


@pytest.fixture()
def bridge_setup(w3, compiled_contracts):
    validator_key = Account.create().key
    validator = Account.from_key(validator_key).address

    token_def = compiled_contracts["TestToken.sol"]["TestToken"]
    bridge_def = compiled_contracts["CrossChainBridge.sol"]["CrossChainBridge"]
    token = deploy(w3, token_def, (10**24,))
    bridge = deploy(w3, bridge_def, (token.address, validator))
    token.functions.transfer(bridge.address, 1_000_000).transact({"from": w3.eth.accounts[0]})

    return {
        "w3": w3,
        "token": token,
        "bridge": bridge,
        "validator_key": validator_key,
        "validator": validator,
    }


def sign_digest(private_key, digest):
    signature = keys.PrivateKey(to_bytes(private_key)).sign_msg_hash(HexBytes(digest))
    return signature.r.to_bytes(32, "big") + signature.s.to_bytes(32, "big") + bytes([signature.v + 27])


def sign_transfer(setup, sender, recipient, amount, nonce):
    digest = setup["bridge"].functions.getTransferHash(sender, recipient, amount, nonce).call()
    return sign_digest(setup["validator_key"], digest)


def test_eip712_domain_separator_matches_contract_context(bridge_setup):
    bridge = bridge_setup["bridge"]
    assert bridge.functions.NAME().call() == "CrossChainBridge"
    assert bridge.functions.VERSION().call() == "1"
    assert bridge.functions.DOMAIN_SEPARATOR().call() != b"\x00" * 32


def test_process_transfer_consumes_sender_nonce_and_blocks_same_chain_replay(bridge_setup):
    bridge = bridge_setup["bridge"]
    token = bridge_setup["token"]
    sender = bridge_setup["w3"].eth.accounts[1]
    recipient = bridge_setup["w3"].eth.accounts[2]
    amount = 1234
    nonce = bridge.functions.getNonce(sender).call()
    signature = sign_transfer(bridge_setup, sender, recipient, amount, nonce)

    bridge.functions.processTransfer(sender, recipient, amount, nonce, signature).transact(
        {"from": bridge_setup["w3"].eth.accounts[0]}
    )

    assert bridge.functions.getNonce(sender).call() == nonce + 1
    assert token.functions.balanceOf(recipient).call() == amount

    with pytest.raises(TransactionFailed):
        bridge.functions.processTransfer(sender, recipient, amount, nonce, signature).transact(
            {"from": bridge_setup["w3"].eth.accounts[0]}
        )


def test_signature_is_bound_to_recipient_amount_chain_and_bridge(bridge_setup, compiled_contracts):
    bridge = bridge_setup["bridge"]
    sender = bridge_setup["w3"].eth.accounts[1]
    recipient = bridge_setup["w3"].eth.accounts[2]
    amount = 500
    nonce = bridge.functions.getNonce(sender).call()
    signature = sign_transfer(bridge_setup, sender, recipient, amount, nonce)

    with pytest.raises(TransactionFailed):
        bridge.functions.processTransfer(sender, bridge_setup["w3"].eth.accounts[3], amount, nonce, signature).transact(
            {"from": bridge_setup["w3"].eth.accounts[0]}
        )

    with pytest.raises(TransactionFailed):
        bridge.functions.processTransfer(sender, recipient, amount + 1, nonce, signature).transact(
            {"from": bridge_setup["w3"].eth.accounts[0]}
        )

    bridge_def = compiled_contracts["CrossChainBridge.sol"]["CrossChainBridge"]
    replacement = deploy(bridge_setup["w3"], bridge_def, (bridge_setup["token"].address, bridge_setup["validator"]))
    with pytest.raises(TransactionFailed):
        replacement.functions.processTransfer(sender, recipient, amount, nonce, signature).transact(
            {"from": bridge_setup["w3"].eth.accounts[0]}
        )


def test_invalid_signature_and_zero_address_recovery_are_rejected(bridge_setup):
    bridge = bridge_setup["bridge"]
    sender = bridge_setup["w3"].eth.accounts[1]
    recipient = bridge_setup["w3"].eth.accounts[2]
    amount = 100
    nonce = bridge.functions.getNonce(sender).call()
    digest = bridge.functions.getTransferHash(sender, recipient, amount, nonce).call()

    invalid_signature = b"\x00" * 65
    assert bridge.functions.verifySignature(digest, invalid_signature).call() is False

    with pytest.raises(TransactionFailed):
        bridge.functions.processTransfer(sender, recipient, amount, nonce, invalid_signature).transact(
            {"from": bridge_setup["w3"].eth.accounts[0]}
        )


def test_initiate_transfer_uses_queryable_sender_nonce(bridge_setup):
    bridge = bridge_setup["bridge"]
    token = bridge_setup["token"]
    sender = bridge_setup["w3"].eth.accounts[0]

    start_nonce = bridge.functions.getNonce(sender).call()
    token.functions.approve(bridge.address, 100).transact({"from": sender})
    bridge.functions.initiateTransfer(100, 8453).transact({"from": sender})

    assert bridge.functions.getNonce(sender).call() == start_nonce + 1
