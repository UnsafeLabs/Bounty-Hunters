const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ethers } = require("ethers");
const ganache = require("ganache");
const solc = require("solc");

const IERC20_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}
`;

const MOCK_ERC20_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ERC20: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
`;

const BPS_DENOMINATOR = 10_000n;
const FEE_BPS = 30n;
const MAX_UINT256 = (1n << 256n) - 1n;

const compiled = compileContracts();

function compileContracts() {
  const simpleSwapPath = path.join(__dirname, "..", "contracts", "SimpleSwap.sol");
  const input = {
    language: "Solidity",
    sources: {
      "contracts/SimpleSwap.sol": {
        content: fs.readFileSync(simpleSwapPath, "utf8"),
      },
      "test/MockERC20.sol": {
        content: MOCK_ERC20_SOURCE,
      },
    },
    settings: {
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath) => {
        if (importPath === "@openzeppelin/contracts/token/ERC20/IERC20.sol") {
          return { contents: IERC20_SOURCE };
        }
        return { error: `File not found: ${importPath}` };
      },
    }),
  );

  const errors = (output.errors || []).filter((error) => error.severity === "error");
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));

  return {
    SimpleSwap: artifact(output, "contracts/SimpleSwap.sol", "SimpleSwap"),
    MockERC20: artifact(output, "test/MockERC20.sol", "MockERC20"),
  };
}

function artifact(output, source, contractName) {
  const contract = output.contracts[source][contractName];
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

function fixedPointAmountOut(reserveIn, reserveOut, amountIn, fee = FEE_BPS) {
  const amountInWithFee = amountIn * (BPS_DENOMINATOR - fee);
  return (reserveOut * amountInWithFee) / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
}

function truncatedFeeAmountOut(reserveIn, reserveOut, amountIn, fee = FEE_BPS) {
  const feeAmount = (amountIn * fee) / BPS_DENOMINATOR;
  const amountInAfterFee = amountIn - feeAmount;
  return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
}

async function deployFixture({ reserveA = 10_000n, reserveB = 10_000n, userA = 10_000n } = {}) {
  const ganacheProvider = ganache.provider({ logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const owner = await provider.getSigner(0);
  const user = await provider.getSigner(1);
  const ownerAddress = await owner.getAddress();
  const userAddress = await user.getAddress();

  const TokenFactory = new ethers.ContractFactory(
    compiled.MockERC20.abi,
    compiled.MockERC20.bytecode,
    owner,
  );
  const tokenA = await TokenFactory.deploy("Token A", "TKA");
  await tokenA.waitForDeployment();
  const tokenB = await TokenFactory.deploy("Token B", "TKB");
  await tokenB.waitForDeployment();

  await (await tokenA.mint(ownerAddress, reserveA)).wait();
  await (await tokenB.mint(ownerAddress, reserveB)).wait();
  await (await tokenA.mint(userAddress, userA)).wait();

  const SwapFactory = new ethers.ContractFactory(
    compiled.SimpleSwap.abi,
    compiled.SimpleSwap.bytecode,
    owner,
  );
  const swap = await SwapFactory.deploy(tokenA.target, tokenB.target, FEE_BPS);
  await swap.waitForDeployment();

  await (await tokenA.approve(swap.target, reserveA)).wait();
  await (await tokenB.approve(swap.target, reserveB)).wait();
  await (await swap.addLiquidity(reserveA, reserveB)).wait();
  await (await tokenA.connect(user).approve(swap.target, MAX_UINT256)).wait();

  return { provider, ganacheProvider, owner, user, tokenA, tokenB, swap };
}

async function futureDeadline(provider) {
  const block = await provider.getBlock("latest");
  return BigInt(block.timestamp + 60);
}

async function assertRevert(promise, reason) {
  try {
    await promise;
  } catch (error) {
    const details = [
      error.shortMessage,
      error.reason,
      error.message,
      error.info ? JSON.stringify(error.info) : "",
    ].join("\n");
    assert.match(details, new RegExp(reason));
    return;
  }

  assert.fail(`Expected revert: ${reason}`);
}

test("swap succeeds when minAmountOut equals the quoted output", async () => {
  const { provider, user, tokenA, tokenB, swap } = await deployFixture();
  const amountIn = 1_000n;
  const expected = await swap.getAmountOut(tokenA.target, amountIn);
  const deadline = await futureDeadline(provider);
  const userAddress = await user.getAddress();
  const balanceBefore = await tokenB.balanceOf(userAddress);

  assert.equal(expected, fixedPointAmountOut(10_000n, 10_000n, amountIn));
  assert.equal(
    await swap.connect(user).swap.staticCall(tokenA.target, amountIn, expected, deadline),
    expected,
  );

  await (await swap.connect(user).swap(tokenA.target, amountIn, expected, deadline)).wait();

  assert.equal((await tokenB.balanceOf(userAddress)) - balanceBefore, expected);
  assert.equal(await swap.reserveA(), 11_000n);
  assert.equal(await swap.reserveB(), 10_000n - expected);
});

test("swap reverts when quoted output is below minAmountOut", async () => {
  const { provider, user, tokenA, swap } = await deployFixture();
  const amountIn = 1_000n;
  const expected = await swap.getAmountOut(tokenA.target, amountIn);
  const deadline = await futureDeadline(provider);

  await assertRevert(
    swap.connect(user).swap(tokenA.target, amountIn, expected + 1n, deadline),
    "Slippage exceeded",
  );
});

test("swap reverts after the caller supplied deadline", async () => {
  const { provider, user, tokenA, swap } = await deployFixture();
  const block = await provider.getBlock("latest");

  await assertRevert(
    swap.connect(user).swap(tokenA.target, 1_000n, 0n, BigInt(block.timestamp - 1)),
    "Deadline expired",
  );
});

test("getAmountOut applies basis-point fees without truncating fee to zero first", async () => {
  const { tokenA, swap } = await deployFixture({ reserveA: 10n, reserveB: 1_000n, userA: 10n });
  const amountIn = 5n;
  const quote = await swap.getAmountOut(tokenA.target, amountIn);

  assert.equal(quote, fixedPointAmountOut(10n, 1_000n, amountIn));
  assert.equal(quote, 332n);
  assert.equal(truncatedFeeAmountOut(10n, 1_000n, amountIn), 333n);
});
