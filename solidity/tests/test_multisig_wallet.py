from pathlib import Path

import pytest
from eth_tester.exceptions import TransactionFailed
from solcx import compile_standard, install_solc
from web3 import EthereumTesterProvider, Web3


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "solidity" / "contracts" / "MultiSigWallet.sol"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

CALLBACK_OWNER_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function confirmTransaction(uint256 txId) external;
    function revokeConfirmation(uint256 txId) external;
}

contract CallbackOwner {
    IMultiSigWallet public wallet;
    uint256 public txToRevoke;
    bool public revokeOnReceive;

    function configure(address wallet_) external {
        wallet = IMultiSigWallet(wallet_);
    }

    function setRevocation(uint256 txId, bool enabled) external {
        txToRevoke = txId;
        revokeOnReceive = enabled;
    }

    function confirm(uint256 txId) external {
        wallet.confirmTransaction(txId);
    }

    receive() external payable {
        if (revokeOnReceive) {
            wallet.revokeConfirmation(txToRevoke);
        }
    }
}
"""


@pytest.fixture(scope="session")
def compiled_contracts():
    install_solc("0.8.20")
    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                "MultiSigWallet.sol": {"content": CONTRACT.read_text(encoding="utf-8")},
                "CallbackOwner.sol": {"content": CALLBACK_OWNER_SOURCE},
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


def deploy_wallet(w3, compiled_contracts, owners=None, required=2):
    owners = owners or [w3.eth.accounts[0], w3.eth.accounts[1]]
    wallet_def = compiled_contracts["MultiSigWallet.sol"]["MultiSigWallet"]
    wallet = deploy(w3, wallet_def, (owners, required))
    w3.eth.send_transaction(
        {
            "from": w3.eth.accounts[0],
            "to": wallet.address,
            "value": w3.to_wei(1, "ether"),
        }
    )
    return wallet


def next_tx_id(wallet):
    return wallet.functions.transactionCount().call()


def submit(wallet, sender, to, value=0, data=b""):
    tx_id = next_tx_id(wallet)
    wallet.functions.submitTransaction(to, value, data).transact({"from": sender})
    return tx_id


def test_normal_submit_confirm_revoke_execute_flow_and_simple_transfer_gas(w3, compiled_contracts):
    wallet = deploy_wallet(w3, compiled_contracts)
    tx_id = submit(wallet, w3.eth.accounts[0], w3.eth.accounts[2], value=1)

    wallet.functions.confirmTransaction(tx_id).transact({"from": w3.eth.accounts[0]})
    wallet.functions.confirmTransaction(tx_id).transact({"from": w3.eth.accounts[1]})
    wallet.functions.revokeConfirmation(tx_id).transact({"from": w3.eth.accounts[1]})
    assert wallet.functions.getConfirmationCount(tx_id).call() == 1

    wallet.functions.confirmTransaction(tx_id).transact({"from": w3.eth.accounts[1]})
    tx_hash = wallet.functions.executeTransaction(tx_id).transact({"from": w3.eth.accounts[0]})
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    assert receipt.gasUsed <= 100_000
    assert wallet.functions.transactions(tx_id).call()[3] is True


def test_zero_address_and_eoa_calldata_targets_are_rejected(w3, compiled_contracts):
    wallet = deploy_wallet(w3, compiled_contracts)

    with pytest.raises(TransactionFailed):
        wallet.functions.submitTransaction(ZERO_ADDRESS, 0, b"").transact({"from": w3.eth.accounts[0]})

    with pytest.raises(TransactionFailed):
        wallet.functions.submitTransaction(w3.eth.accounts[2], 0, b"\x12\x34").transact(
            {"from": w3.eth.accounts[0]}
        )


def test_revocation_before_execution_blocks_front_running_attempt(w3, compiled_contracts):
    wallet = deploy_wallet(w3, compiled_contracts)
    tx_id = submit(wallet, w3.eth.accounts[0], w3.eth.accounts[2], value=1)

    wallet.functions.confirmTransaction(tx_id).transact({"from": w3.eth.accounts[0]})
    wallet.functions.confirmTransaction(tx_id).transact({"from": w3.eth.accounts[1]})
    confirmed_block = wallet.functions.confirmationBlock(tx_id, w3.eth.accounts[1]).call()
    assert wallet.functions.isConfirmedAtBlock(tx_id, w3.eth.accounts[1], confirmed_block).call()

    wallet.functions.revokeConfirmation(tx_id).transact({"from": w3.eth.accounts[1]})
    with pytest.raises(TransactionFailed):
        wallet.functions.executeTransaction(tx_id).transact({"from": w3.eth.accounts[0]})

    wallet.functions.confirmTransaction(tx_id).transact({"from": w3.eth.accounts[1]})
    wallet.functions.executeTransaction(tx_id).transact({"from": w3.eth.accounts[0]})
    assert wallet.functions.transactions(tx_id).call()[3] is True


def test_callback_time_revocation_reverts_execution(w3, compiled_contracts):
    callback_def = compiled_contracts["CallbackOwner.sol"]["CallbackOwner"]
    callback_owner = deploy(w3, callback_def)
    wallet = deploy_wallet(w3, compiled_contracts, owners=[w3.eth.accounts[0], callback_owner.address])
    callback_owner.functions.configure(wallet.address).transact({"from": w3.eth.accounts[0]})

    tx_id = submit(wallet, w3.eth.accounts[0], callback_owner.address, value=1)
    callback_owner.functions.setRevocation(tx_id, True).transact({"from": w3.eth.accounts[0]})
    wallet.functions.confirmTransaction(tx_id).transact({"from": w3.eth.accounts[0]})
    callback_owner.functions.confirm(tx_id).transact({"from": w3.eth.accounts[0]})

    with pytest.raises(TransactionFailed):
        wallet.functions.executeTransaction(tx_id).transact({"from": w3.eth.accounts[0]})

    assert wallet.functions.transactions(tx_id).call()[3] is False
    assert wallet.functions.confirmations(tx_id, callback_owner.address).call() is True
