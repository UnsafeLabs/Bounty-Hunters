from pathlib import Path

import pytest
from eth_tester import EthereumTester, PyEVMBackend
from solcx import compile_standard, install_solc
from web3 import EthereumTesterProvider, Web3


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "solidity" / "contracts" / "FlashLoan.sol"

IERC20_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
"""

TOKEN_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TestToken {
    string public name = "Loan Token";
    string public symbol = "LOAN";
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

REBASING_TOKEN_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RebasingToken {
    string public name = "Rebasing Token";
    string public symbol = "RBS";
    uint8 public decimals = 18;
    mapping(address => uint256) private balances;
    mapping(address => uint256) public bonusBalance;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply) {
        balances[msg.sender] = supply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account] + bonusBalance[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balances[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }

    function rebaseFor(address account, uint256 amount) external {
        bonusBalance[account] += amount;
    }
}
"""

BORROWER_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IFlashLoanLike {
    function flashLoan(uint256 amount, bytes calldata data) external;
}

interface IRebasingTokenLike {
    function approve(address spender, uint256 amount) external returns (bool);
    function rebaseFor(address account, uint256 amount) external;
}

contract RepayingBorrower {
    function executeLoan(address lender, uint256 amount) external {
        IFlashLoanLike(lender).flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        IERC20Like(token).approve(msg.sender, amount + fee);
    }
}

contract RebasingAttackBorrower {
    function executeLoan(address lender, uint256 amount) external {
        IFlashLoanLike(lender).flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        IRebasingTokenLike(token).rebaseFor(msg.sender, amount + fee);
        IRebasingTokenLike(token).approve(msg.sender, amount + fee);
    }
}
"""


@pytest.fixture(scope="session")
def compiled_contracts():
    install_solc("0.8.20")
    output = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                "FlashLoan.sol": {"content": CONTRACT.read_text(encoding="utf-8")},
                "@openzeppelin/contracts/token/ERC20/IERC20.sol": {"content": IERC20_SOURCE},
                "TestToken.sol": {"content": TOKEN_SOURCE},
                "RebasingToken.sol": {"content": REBASING_TOKEN_SOURCE},
                "Borrowers.sol": {"content": BORROWER_SOURCE},
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
def chain(compiled_contracts):
    tester = EthereumTester(PyEVMBackend())
    return Web3(EthereumTesterProvider(tester))


def deploy(w3, contract_def, *args):
    contract = w3.eth.contract(
        abi=contract_def["abi"],
        bytecode=contract_def["evm"]["bytecode"]["object"],
    )
    tx_hash = contract.constructor(*args).transact({"from": w3.eth.accounts[0]})
    address = w3.eth.wait_for_transaction_receipt(tx_hash).contractAddress
    return w3.eth.contract(address=address, abi=contract_def["abi"])


def deploy_pool(w3, compiled_contracts, token_name="TestToken", fee_bps=1, deposit=1_000):
    token = deploy(w3, compiled_contracts[f"{token_name}.sol"][token_name], 10**24)
    lender = deploy(w3, compiled_contracts["FlashLoan.sol"]["FlashLoan"], token.address, fee_bps)
    token.functions.approve(lender.address, deposit).transact({"from": w3.eth.accounts[0]})
    lender.functions.depositToPool(deposit).transact({"from": w3.eth.accounts[0]})
    return token, lender


def deploy_borrower(w3, compiled_contracts, name="RepayingBorrower"):
    return deploy(w3, compiled_contracts["Borrowers.sol"][name])


def test_minimum_fee_prevents_zero_fee_loans(chain, compiled_contracts):
    token, lender = deploy_pool(chain, compiled_contracts, fee_bps=1, deposit=1_000)
    borrower = deploy_borrower(chain, compiled_contracts)

    token.functions.transfer(borrower.address, 1).transact({"from": chain.eth.accounts[0]})
    borrower.functions.executeLoan(lender.address, 1).transact({"from": chain.eth.accounts[0]})

    assert lender.functions.calculateFee(1).call() == 1
    assert lender.functions.totalFees().call() == 1
    assert lender.functions.getPoolBalance().call() == 1_001


def test_loans_above_half_the_pool_are_rejected(chain, compiled_contracts):
    token, lender = deploy_pool(chain, compiled_contracts, fee_bps=100, deposit=1_000)
    borrower = deploy_borrower(chain, compiled_contracts)

    token.functions.transfer(borrower.address, 10).transact({"from": chain.eth.accounts[0]})

    assert lender.functions.maxLoanAmount().call() == 500
    with pytest.raises(Exception, match="Exceeds max loan"):
        borrower.functions.executeLoan(lender.address, 501).transact({"from": chain.eth.accounts[0]})


def test_internal_accounting_blocks_rebasing_balance_spoof(chain, compiled_contracts):
    token, lender = deploy_pool(chain, compiled_contracts, token_name="RebasingToken", fee_bps=100, deposit=1_000)
    attacker = deploy_borrower(chain, compiled_contracts, name="RebasingAttackBorrower")

    assert lender.functions.getPoolBalance().call() == 1_000
    with pytest.raises(Exception, match="Loan not repaid|balance"):
        attacker.functions.executeLoan(lender.address, 100).transact({"from": chain.eth.accounts[0]})

    assert lender.functions.getPoolBalance().call() == 1_000
    assert lender.functions.totalFees().call() == 0
    assert token.functions.balanceOf(lender.address).call() == 1_000


def test_pause_disables_and_unpause_reenables_flash_loans(chain, compiled_contracts):
    token, lender = deploy_pool(chain, compiled_contracts, fee_bps=100, deposit=1_000)
    borrower = deploy_borrower(chain, compiled_contracts)
    token.functions.transfer(borrower.address, 1).transact({"from": chain.eth.accounts[0]})

    lender.functions.pause().transact({"from": chain.eth.accounts[0]})
    with pytest.raises(Exception, match="Paused"):
        borrower.functions.executeLoan(lender.address, 100).transact({"from": chain.eth.accounts[0]})

    lender.functions.unpause().transact({"from": chain.eth.accounts[0]})
    borrower.functions.executeLoan(lender.address, 100).transact({"from": chain.eth.accounts[0]})

    assert lender.functions.totalFees().call() == 1


def test_fee_accrual_tracks_pool_shares_and_withdrawal(chain, compiled_contracts):
    token, lender = deploy_pool(chain, compiled_contracts, fee_bps=100, deposit=1_000)
    borrower = deploy_borrower(chain, compiled_contracts)
    token.functions.transfer(borrower.address, 1).transact({"from": chain.eth.accounts[0]})

    borrower.functions.executeLoan(lender.address, 100).transact({"from": chain.eth.accounts[0]})

    assert lender.functions.totalFees().call() == 1
    assert lender.functions.getPoolBalance().call() == 1_001

    lender.functions.withdrawFees().transact({"from": chain.eth.accounts[0]})

    assert lender.functions.totalFees().call() == 0
    assert lender.functions.getPoolBalance().call() == 1_000
