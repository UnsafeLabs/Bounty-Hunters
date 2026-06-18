from pathlib import Path

import pytest
from eth_tester.exceptions import TransactionFailed
from solcx import compile_standard, install_solc
from web3 import EthereumTesterProvider, Web3


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "solidity" / "contracts" / "LiquidityPool.sol"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
MINIMUM_LIQUIDITY = 1000

ERC20_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return _balances[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_balances[msg.sender] >= amount, "balance");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_balances[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) internal virtual {
        require(to != address(0), "mint to zero");
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal virtual {
        require(_balances[from] >= amount, "burn amount exceeds balance");
        _balances[from] -= amount;
        _totalSupply -= amount;
        emit Transfer(from, address(0), amount);
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

TOKEN_SOURCE = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TestToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint256 supply) {
        name = name_;
        symbol = symbol_;
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


@pytest.fixture(scope="session")
def compiled_contracts():
    install_solc("0.8.20")
    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                "LiquidityPool.sol": {"content": CONTRACT.read_text(encoding="utf-8")},
                "@openzeppelin/contracts/token/ERC20/ERC20.sol": {"content": ERC20_SOURCE},
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
def pool_setup(w3, compiled_contracts):
    token_def = compiled_contracts["TestToken.sol"]["TestToken"]
    pool_def = compiled_contracts["LiquidityPool.sol"]["LiquidityPool"]
    token_a = deploy(w3, token_def, ("Token A", "TKNA", 10**24))
    token_b = deploy(w3, token_def, ("Token B", "TKNB", 10**24))
    pool = deploy(w3, pool_def, (token_a.address, token_b.address))

    for token in (token_a, token_b):
        token.functions.approve(pool.address, 10**24).transact({"from": w3.eth.accounts[0]})
        token.functions.transfer(w3.eth.accounts[1], 2_000_000).transact({"from": w3.eth.accounts[0]})
        token.functions.approve(pool.address, 2_000_000).transact({"from": w3.eth.accounts[1]})

    return {"w3": w3, "token_a": token_a, "token_b": token_b, "pool": pool}


def test_first_deposit_locks_minimum_liquidity(pool_setup):
    pool = pool_setup["pool"]

    pool.functions.addLiquidity(1_000_000, 1_000_000).transact({"from": pool_setup["w3"].eth.accounts[0]})

    assert pool.functions.balanceOf(ZERO_ADDRESS).call() == MINIMUM_LIQUIDITY
    assert pool.functions.balanceOf(pool_setup["w3"].eth.accounts[0]).call() == 999_000
    assert pool.functions.totalSupply().call() == 1_000_000
    assert pool.functions.reserveA().call() == 1_000_000
    assert pool.functions.reserveB().call() == 1_000_000


def test_first_deposit_must_exceed_minimum_lock(pool_setup):
    with pytest.raises(TransactionFailed):
        pool_setup["pool"].functions.addLiquidity(100, 100).transact({"from": pool_setup["w3"].eth.accounts[0]})


def test_subsequent_deposit_uses_internal_reserve_ratio(pool_setup):
    pool = pool_setup["pool"]
    pool.functions.addLiquidity(1_000_000, 1_000_000).transact({"from": pool_setup["w3"].eth.accounts[0]})
    pool.functions.addLiquidity(500_000, 500_000).transact({"from": pool_setup["w3"].eth.accounts[1]})

    assert pool.functions.balanceOf(pool_setup["w3"].eth.accounts[1]).call() == 500_000
    assert pool.functions.totalSupply().call() == 1_500_000
    assert pool.functions.reserveA().call() == 1_500_000
    assert pool.functions.reserveB().call() == 1_500_000


def test_direct_donation_does_not_affect_remove_liquidity_pricing(pool_setup):
    pool = pool_setup["pool"]
    token_a = pool_setup["token_a"]
    token_b = pool_setup["token_b"]
    owner = pool_setup["w3"].eth.accounts[0]

    pool.functions.addLiquidity(1_000_000, 1_000_000).transact({"from": owner})
    token_a.functions.transfer(pool.address, 999_000).transact({"from": owner})

    before_a = token_a.functions.balanceOf(owner).call()
    before_b = token_b.functions.balanceOf(owner).call()
    pool.functions.removeLiquidity(100_000).transact({"from": owner})

    assert token_a.functions.balanceOf(owner).call() - before_a == 100_000
    assert token_b.functions.balanceOf(owner).call() - before_b == 100_000
    assert pool.functions.reserveA().call() == 900_000
    assert pool.functions.reserveB().call() == 900_000


def test_sync_updates_reserves_after_donation(pool_setup):
    pool = pool_setup["pool"]
    token_a = pool_setup["token_a"]
    owner = pool_setup["w3"].eth.accounts[0]

    pool.functions.addLiquidity(1_000_000, 1_000_000).transact({"from": owner})
    token_a.functions.transfer(pool.address, 250_000).transact({"from": owner})

    assert pool.functions.reserveA().call() == 1_000_000
    pool.functions.sync().transact({"from": owner})
    assert pool.functions.reserveA().call() == 1_250_000
    assert pool.functions.reserveB().call() == 1_000_000
