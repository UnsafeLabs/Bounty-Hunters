from pathlib import Path

import pytest
from eth_tester import EthereumTester, PyEVMBackend
from solcx import compile_standard, install_solc
from web3 import EthereumTesterProvider, Web3


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "solidity" / "contracts" / "MultiSigWallet.sol"

RECEIVER_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiSigWallet {
    function revokeConfirmation(uint256 txId) external;
}

contract CallbackReceiver {
    IMultiSigWallet public wallet;
    uint256 public txToRevoke;
    bool public shouldTryRevoke;

    function configure(address wallet_, uint256 txId_, bool shouldTryRevoke_) external {
        wallet = IMultiSigWallet(wallet_);
        txToRevoke = txId_;
        shouldTryRevoke = shouldTryRevoke_;
    }

    receive() external payable {
        if (shouldTryRevoke) {
            try wallet.revokeConfirmation(txToRevoke) {} catch {}
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
                "CallbackReceiver.sol": {"content": RECEIVER_SOURCE},
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
    wallet_def = compiled_contracts["MultiSigWallet.sol"]["MultiSigWallet"]
    wallet_contract = w3.eth.contract(
        abi=wallet_def["abi"],
        bytecode=wallet_def["evm"]["bytecode"]["object"],
    )
    owners = [w3.eth.accounts[0], w3.eth.accounts[1]]
    wallet_tx = wallet_contract.constructor(owners, 2).transact({"from": w3.eth.accounts[0]})
    wallet_addr = w3.eth.wait_for_transaction_receipt(wallet_tx).contractAddress
    wallet = w3.eth.contract(address=wallet_addr, abi=wallet_def["abi"])
    w3.eth.send_transaction({"from": w3.eth.accounts[0], "to": wallet_addr, "value": w3.to_wei(1, "ether")})

    receiver_def = compiled_contracts["CallbackReceiver.sol"]["CallbackReceiver"]
    receiver_contract = w3.eth.contract(
        abi=receiver_def["abi"],
        bytecode=receiver_def["evm"]["bytecode"]["object"],
    )
    receiver_tx = receiver_contract.constructor().transact({"from": w3.eth.accounts[0]})
    receiver_addr = w3.eth.wait_for_transaction_receipt(receiver_tx).contractAddress
    receiver = w3.eth.contract(address=receiver_addr, abi=receiver_def["abi"])

    return {"w3": w3, "wallet": wallet, "receiver": receiver}


def submit_confirmed_transfer(wallet, sender, co_owner, target, value):
    tx = wallet.functions.submitTransaction(target, value, b"").transact({"from": sender})
    receipt = wallet.w3.eth.wait_for_transaction_receipt(tx)
    tx_id = wallet.events.Submitted().process_receipt(receipt)[0]["args"]["txId"]
    wallet.functions.confirmTransaction(tx_id).transact({"from": sender})
    wallet.functions.confirmTransaction(tx_id).transact({"from": co_owner})
    return tx_id


def test_zero_address_transactions_are_rejected(chain):
    wallet = chain["wallet"]
    owner = chain["w3"].eth.accounts[0]

    with pytest.raises(Exception, match="Invalid target"):
        wallet.functions.submitTransaction("0x0000000000000000000000000000000000000000", 0, b"").transact({"from": owner})


def test_front_running_revocation_removes_confirmation_at_current_block(chain):
    w3 = chain["w3"]
    wallet = chain["wallet"]
    owner = w3.eth.accounts[0]
    co_owner = w3.eth.accounts[1]
    recipient = w3.eth.accounts[2]
    tx_id = submit_confirmed_transfer(wallet, owner, co_owner, recipient, 1)
    snapshot_block = w3.eth.block_number

    assert wallet.functions.getConfirmationCountAtBlock(tx_id, snapshot_block).call() == 2

    wallet.functions.revokeConfirmation(tx_id).transact({"from": co_owner})

    assert wallet.functions.isConfirmedAtBlock(tx_id, co_owner, snapshot_block).call() is True
    assert wallet.functions.isConfirmedAtBlock(tx_id, co_owner, w3.eth.block_number).call() is False
    with pytest.raises(Exception, match="Not enough confirmations"):
        wallet.functions.executeTransaction(tx_id).transact({"from": owner})


def test_callback_cannot_revoke_confirmation_during_execution(chain):
    w3 = chain["w3"]
    wallet = chain["wallet"]
    receiver = chain["receiver"]
    owner = w3.eth.accounts[0]
    co_owner = w3.eth.accounts[1]
    tx_id = submit_confirmed_transfer(wallet, owner, co_owner, receiver.address, 1)
    receiver.functions.configure(wallet.address, tx_id, True).transact({"from": owner})

    wallet.functions.executeTransaction(tx_id).transact({"from": owner})

    assert wallet.functions.getConfirmationCount(tx_id).call() == 2
    assert wallet.functions.transactions(tx_id).call()[3] is True


def test_existing_submit_confirm_execute_and_revoke_flows_work(chain):
    w3 = chain["w3"]
    wallet = chain["wallet"]
    owner = w3.eth.accounts[0]
    co_owner = w3.eth.accounts[1]
    recipient = w3.eth.accounts[2]

    tx = wallet.functions.submitTransaction(recipient, 5, b"").transact({"from": owner})
    receipt = w3.eth.wait_for_transaction_receipt(tx)
    tx_id = wallet.events.Submitted().process_receipt(receipt)[0]["args"]["txId"]
    wallet.functions.confirmTransaction(tx_id).transact({"from": owner})
    wallet.functions.confirmTransaction(tx_id).transact({"from": co_owner})
    wallet.functions.revokeConfirmation(tx_id).transact({"from": co_owner})
    wallet.functions.confirmTransaction(tx_id).transact({"from": co_owner})
    exec_tx = wallet.functions.executeTransaction(tx_id).transact({"from": owner})
    exec_receipt = w3.eth.wait_for_transaction_receipt(exec_tx)

    assert exec_receipt.gasUsed < 100_000
    assert wallet.functions.transactions(tx_id).call()[3] is True

