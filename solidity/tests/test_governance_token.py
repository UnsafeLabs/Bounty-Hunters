from pathlib import Path

import pytest
from eth_tester import EthereumTester, PyEVMBackend
from solcx import compile_standard, install_solc
from web3 import EthereumTesterProvider, Web3


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "solidity" / "contracts" / "GovernanceToken.sol"

ERC20_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balances[to] += amount;
    }

    function balanceOf(address account) public view returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }
}
"""

OWNABLE_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Ownable {
    address private _owner;

    constructor(address initialOwner) {
        require(initialOwner != address(0), "Invalid owner");
        _owner = initialOwner;
    }

    modifier onlyOwner() {
        require(msg.sender == _owner, "Ownable: caller is not the owner");
        _;
    }

    function owner() public view returns (address) {
        return _owner;
    }
}
"""

PHISHING_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
    function revokeDelegate() external;
    function snapshot() external;
}

contract GovernancePhisher {
    function attackDelegate(address token, address attacker) external {
        IGovernanceToken(token).delegateVote(attacker);
    }

    function attackRevoke(address token) external {
        IGovernanceToken(token).revokeDelegate();
    }

    function attackSnapshot(address token) external {
        IGovernanceToken(token).snapshot();
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
                "GovernanceToken.sol": {"content": CONTRACT.read_text(encoding="utf-8")},
                "@openzeppelin/contracts/token/ERC20/ERC20.sol": {"content": ERC20_SOURCE},
                "@openzeppelin/contracts/access/Ownable.sol": {"content": OWNABLE_SOURCE},
                "GovernancePhisher.sol": {"content": PHISHING_SOURCE},
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
    token_def = compiled_contracts["GovernanceToken.sol"]["GovernanceToken"]
    token_contract = w3.eth.contract(
        abi=token_def["abi"],
        bytecode=token_def["evm"]["bytecode"]["object"],
    )
    token_tx = token_contract.constructor(1_000).transact({"from": w3.eth.accounts[0]})
    token_addr = w3.eth.wait_for_transaction_receipt(token_tx).contractAddress
    token = w3.eth.contract(address=token_addr, abi=token_def["abi"])

    phisher_def = compiled_contracts["GovernancePhisher.sol"]["GovernancePhisher"]
    phisher_contract = w3.eth.contract(
        abi=phisher_def["abi"],
        bytecode=phisher_def["evm"]["bytecode"]["object"],
    )
    phisher_tx = phisher_contract.constructor().transact({"from": w3.eth.accounts[0]})
    phisher_addr = w3.eth.wait_for_transaction_receipt(phisher_tx).contractAddress
    phisher = w3.eth.contract(address=phisher_addr, abi=phisher_def["abi"])

    token.functions.transfer(w3.eth.accounts[1], 250).transact({"from": w3.eth.accounts[0]})

    return {"w3": w3, "token": token, "phisher": phisher}


def test_phishing_contract_cannot_delegate_victim_votes(chain):
    w3 = chain["w3"]
    token = chain["token"]
    phisher = chain["phisher"]
    victim = w3.eth.accounts[1]
    attacker = w3.eth.accounts[2]

    phisher.functions.attackDelegate(token.address, attacker).transact({"from": victim})

    assert token.functions.delegates(victim).call() == "0x0000000000000000000000000000000000000000"
    assert token.functions.delegatedPower(attacker).call() == 0
    assert token.functions.delegates(phisher.address).call() == attacker


def test_legitimate_delegation_and_revoke_still_work(chain):
    w3 = chain["w3"]
    token = chain["token"]
    victim = w3.eth.accounts[1]
    delegate = w3.eth.accounts[2]

    token.functions.delegateVote(delegate).transact({"from": victim})
    assert token.functions.delegates(victim).call() == delegate
    assert token.functions.delegatedPower(delegate).call() == 250
    assert token.functions.getVotingPower(delegate).call() == 250

    token.functions.revokeDelegate().transact({"from": victim})
    assert token.functions.delegates(victim).call() == "0x0000000000000000000000000000000000000000"
    assert token.functions.delegatedPower(delegate).call() == 0


def test_snapshot_uses_msg_sender_owner_not_tx_origin(chain):
    w3 = chain["w3"]
    token = chain["token"]
    phisher = chain["phisher"]
    owner = w3.eth.accounts[0]

    token.functions.snapshot().transact({"from": owner})

    with pytest.raises(Exception, match="Ownable: caller is not the owner"):
        phisher.functions.attackSnapshot(token.address).transact({"from": owner})


def test_no_tx_origin_remains_in_contract():
    assert "tx.origin" not in CONTRACT.read_text(encoding="utf-8")
