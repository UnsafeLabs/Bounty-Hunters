from pathlib import Path

import pytest
from eth_account import Account
from eth_abi import encode
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
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode.object"]}}
            },
        },
        solc_version="0.8.20",
    )
    return compiled["contracts"]


@pytest.fixture()
def chain(compiled_contracts):
    tester = EthereumTester(PyEVMBackend())
    w3 = Web3(EthereumTesterProvider(tester))
    validator_key = Account.create().key
    validator = Account.from_key(validator_key).address

    token_def = compiled_contracts["TestToken.sol"]["TestToken"]
    token_contract = w3.eth.contract(
        abi=token_def["abi"],
        bytecode=token_def["evm"]["bytecode"]["object"],
    )
    token_tx = token_contract.constructor(10**24).transact({"from": w3.eth.accounts[0]})
    token_addr = w3.eth.wait_for_transaction_receipt(token_tx).contractAddress

    bridge_def = compiled_contracts["CrossChainBridge.sol"]["CrossChainBridge"]
    bridge_contract = w3.eth.contract(
        abi=bridge_def["abi"],
        bytecode=bridge_def["evm"]["bytecode"]["object"],
    )
    bridge_tx = bridge_contract.constructor(token_addr, validator).transact({"from": w3.eth.accounts[0]})
    bridge_addr = w3.eth.wait_for_transaction_receipt(bridge_tx).contractAddress

    token = w3.eth.contract(address=token_addr, abi=token_def["abi"])
    bridge = w3.eth.contract(address=bridge_addr, abi=bridge_def["abi"])
    token.functions.transfer(bridge_addr, 1_000_000).transact({"from": w3.eth.accounts[0]})

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


def test_transfer_hash_uses_eip712_domain_and_contract_nonce(chain):
    w3 = chain["w3"]
    bridge = chain["bridge"]
    recipient = w3.eth.accounts[1]

    nonce = bridge.functions.nonces(recipient).call()
    digest = bridge.functions.getTransferHash(recipient, 100, nonce).call()
    signature = sign_digest(chain["validator_key"], digest)

    bridge.functions.processTransfer(recipient, 100, nonce, signature).transact({"from": w3.eth.accounts[0]})

    assert bridge.functions.nonces(recipient).call() == nonce + 1
    assert chain["token"].functions.balanceOf(recipient).call() == 100


def test_same_chain_replay_is_rejected_by_nonce(chain):
    w3 = chain["w3"]
    bridge = chain["bridge"]
    recipient = w3.eth.accounts[1]
    digest = bridge.functions.getTransferHash(recipient, 100, 0).call()
    signature = sign_digest(chain["validator_key"], digest)

    bridge.functions.processTransfer(recipient, 100, 0, signature).transact({"from": w3.eth.accounts[0]})

    with pytest.raises(Exception, match="Invalid nonce|Already processed"):
        bridge.functions.processTransfer(recipient, 100, 0, signature).transact({"from": w3.eth.accounts[0]})


def test_post_upgrade_replay_is_rejected_by_verifying_contract(compiled_contracts, chain):
    w3 = chain["w3"]
    token = chain["token"]
    bridge = chain["bridge"]
    recipient = w3.eth.accounts[1]
    digest = bridge.functions.getTransferHash(recipient, 100, 0).call()
    signature = sign_digest(chain["validator_key"], digest)

    bridge_def = compiled_contracts["CrossChainBridge.sol"]["CrossChainBridge"]
    bridge_contract = w3.eth.contract(
        abi=bridge_def["abi"],
        bytecode=bridge_def["evm"]["bytecode"]["object"],
    )
    bridge_tx = bridge_contract.constructor(token.address, chain["validator"]).transact({"from": w3.eth.accounts[0]})
    new_bridge_addr = w3.eth.wait_for_transaction_receipt(bridge_tx).contractAddress
    new_bridge = w3.eth.contract(address=new_bridge_addr, abi=bridge_def["abi"])
    token.functions.transfer(new_bridge_addr, 1_000_000).transact({"from": w3.eth.accounts[0]})

    with pytest.raises(Exception, match="Invalid signature"):
        new_bridge.functions.processTransfer(recipient, 100, 0, signature).transact({"from": w3.eth.accounts[0]})


def test_invalid_signature_zero_address_recovery_is_rejected(chain):
    w3 = chain["w3"]
    bridge = chain["bridge"]
    recipient = w3.eth.accounts[1]
    digest = bridge.functions.getTransferHash(recipient, 100, 0).call()
    invalid_signature = bytes(65)

    assert bridge.functions.verifySignature(digest, invalid_signature).call() is False

    with pytest.raises(Exception, match="Invalid signature"):
        bridge.functions.processTransfer(recipient, 100, 0, invalid_signature).transact({"from": w3.eth.accounts[0]})


def test_domain_separator_includes_chain_id_and_verifying_contract(chain):
    w3 = chain["w3"]
    bridge = chain["bridge"]
    domain_typehash = keccak(text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    expected = keccak(
        encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
            domain_typehash,
            keccak(text="CrossChainBridge"),
            keccak(text="1"),
            w3.eth.chain_id,
            to_checksum_address(bridge.address),
            ],
        )
    )

    assert bridge.functions.DOMAIN_SEPARATOR().call() == expected


def test_contract_contains_queryable_nonce_mapping():
    assert "mapping(address => uint256) public nonces" in CONTRACT.read_text(encoding="utf-8")
