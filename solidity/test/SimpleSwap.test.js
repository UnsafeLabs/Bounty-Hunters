const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const contractPath = path.join(__dirname, "..", "contracts", "SimpleSwap.sol");
const source = fs.readFileSync(contractPath, "utf8");
const ierc20 = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}
`;

let server;
let provider;
let accounts;
let compiled;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/SimpleSwap.sol": { content: source },
      "@openzeppelin/contracts/token/ERC20/IERC20.sol": { content: ierc20 },
      "test/MockERC20.sol": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
`,
      },
    },
    settings: {
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(name, signer, args = []) {
  const artifact =
    compiled["contracts/SimpleSwap.sol"]?.[name] ?? compiled["test/MockERC20.sol"][name];
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    signer,
  );
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function latestTimestamp() {
  const block = await provider.getBlock("latest");
  return BigInt(block.timestamp);
}

async function deploySwap({ liquidity = ethers.parseEther("1000"), traderAmount = ethers.parseEther("100") } = {}) {
  const [owner, trader] = accounts;
  const tokenA = await deploy("MockERC20", owner, ["Token A", "TKA"]);
  const tokenB = await deploy("MockERC20", owner, ["Token B", "TKB"]);
  const swap = await deploy("SimpleSwap", owner, [
    await tokenA.getAddress(),
    await tokenB.getAddress(),
    30,
  ]);
  await tokenA.mint(owner.address, liquidity);
  await tokenB.mint(owner.address, liquidity);
  await tokenA.mint(trader.address, traderAmount);
  await tokenB.mint(trader.address, traderAmount);
  await tokenA.approve(await swap.getAddress(), liquidity);
  await tokenB.approve(await swap.getAddress(), liquidity);
  await swap.addLiquidity(liquidity, liquidity);
  await tokenA.connect(trader).approve(await swap.getAddress(), traderAmount);
  await tokenB.connect(trader).approve(await swap.getAddress(), traderAmount);

  return { owner, trader, tokenA, tokenB, swap };
}

before(async () => {
  compiled = compileContracts();
  server = ganache.server({ logging: { quiet: true } });
  await server.listen(0);
  provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${server.address().port}`);
  accounts = await provider.listAccounts();
});

after(async () => {
  await provider?.destroy();
  await server?.close();
});

test("executes a swap when exact expected output satisfies minAmountOut", async () => {
  const { trader, tokenA, tokenB, swap } = await deploySwap();
  const amountIn = ethers.parseEther("10");
  const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
  const deadline = (await latestTimestamp()) + 60n;
  const balanceBefore = await tokenB.balanceOf(trader.address);

  await swap.connect(trader).swap(await tokenA.getAddress(), amountIn, expectedOut, deadline);

  assert.equal(await tokenB.balanceOf(trader.address), balanceBefore + expectedOut);
});

test("reverts when output is below minAmountOut", async () => {
  const { trader, tokenA, swap } = await deploySwap();
  const amountIn = ethers.parseEther("10");
  const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
  const deadline = (await latestTimestamp()) + 60n;

  await assert.rejects(
    swap.connect(trader).swap(await tokenA.getAddress(), amountIn, expectedOut + 1n, deadline),
  );
});

test("reverts expired swaps", async () => {
  const { trader, tokenA, swap } = await deploySwap();
  const amountIn = ethers.parseEther("10");
  const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
  const deadline = (await latestTimestamp()) - 1n;

  await assert.rejects(
    swap.connect(trader).swap(await tokenA.getAddress(), amountIn, expectedOut, deadline),
  );
});

test("uses fee-adjusted input before division", async () => {
  const liquidity = 10_000n;
  const { tokenA, swap } = await deploySwap({ liquidity, traderAmount: liquidity });
  const amountIn = 3333n;
  const amountInWithFee = amountIn * 9970n;
  const expectedOut = liquidity * amountInWithFee / (liquidity * 10000n + amountInWithFee);

  assert.equal(await swap.getAmountOut(await tokenA.getAddress(), amountIn), expectedOut);
});
