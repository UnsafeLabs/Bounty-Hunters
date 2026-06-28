const { expect } = require("chai");
const { ethers } = require("ethers");
const ganache = require("ganache");
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const rootDir = path.join(__dirname, "..");
const parseUnits = ethers.parseUnits;

function readSource(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function findImport(importPath) {
  const candidates = [
    path.join(rootDir, importPath),
    path.join(rootDir, "node_modules", importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `File not found: ${importPath}` };
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/SimpleSwap.sol": {
        content: readSource("contracts/SimpleSwap.sol"),
      },
      "contracts/test/MockSwapToken.sol": {
        content: readSource("contracts/test/MockSwapToken.sol"),
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = (output.errors || []).filter((error) => error.severity === "error");
  expect(errors.map((error) => error.formattedMessage)).to.deep.equal([]);
  return output.contracts;
}

function getArtifact(contracts, sourcePath, contractName) {
  const artifact = contracts[sourcePath][contractName];
  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
  };
}

async function deploy(signer, artifact, args = []) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(promiseFactory, expectedMessage) {
  try {
    await promiseFactory();
  } catch (error) {
    if (expectedMessage) {
      const text = [
        error.message,
        error.shortMessage,
        error.reason,
        error.info && error.info.error && error.info.error.message,
      ]
        .filter(Boolean)
        .join("\n");
      expect(text).to.include(expectedMessage);
    }
    return;
  }
  throw new Error("Expected transaction to revert");
}

async function latestTimestamp(provider) {
  return BigInt((await provider.getBlock("latest")).timestamp);
}

describe("SimpleSwap slippage and deadline protection", function () {
  let contracts;
  let tokenArtifact;
  let swapArtifact;
  let provider;
  let owner;
  let trader;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(contracts, "contracts/test/MockSwapToken.sol", "MockSwapToken");
    swapArtifact = getArtifact(contracts, "contracts/SimpleSwap.sol", "SimpleSwap");
  });

  beforeEach(async function () {
    provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    owner = await provider.getSigner(0);
    trader = await provider.getSigner(1);
  });

  async function deployPool(feeBps = 30n) {
    const tokenA = await deploy(owner, tokenArtifact);
    const tokenB = await deploy(owner, tokenArtifact);
    const swap = await deploy(owner, swapArtifact, [
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      feeBps,
    ]);

    await (await tokenA.mint(await owner.getAddress(), parseUnits("1000", 18))).wait();
    await (await tokenB.mint(await owner.getAddress(), parseUnits("1000", 18))).wait();
    await (await tokenA.mint(await trader.getAddress(), parseUnits("100", 18))).wait();
    await (await tokenB.mint(await trader.getAddress(), parseUnits("100", 18))).wait();

    await (await tokenA.approve(await swap.getAddress(), parseUnits("1000", 18))).wait();
    await (await tokenB.approve(await swap.getAddress(), parseUnits("1000", 18))).wait();
    await (await swap.addLiquidity(parseUnits("1000", 18), parseUnits("1000", 18))).wait();

    await (
      await tokenA.connect(trader).approve(await swap.getAddress(), parseUnits("100", 18))
    ).wait();
    await (
      await tokenB.connect(trader).approve(await swap.getAddress(), parseUnits("100", 18))
    ).wait();

    return { tokenA, tokenB, swap };
  }

  it("executes a swap when the exact expected output satisfies minAmountOut", async function () {
    const { tokenA, tokenB, swap } = await deployPool();
    const amountIn = parseUnits("10", 18);
    const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
    const deadline = (await latestTimestamp(provider)) + 60n;
    const traderBalanceBefore = await tokenB.balanceOf(await trader.getAddress());

    await (
      await swap
        .connect(trader)
        .swap(await tokenA.getAddress(), amountIn, expectedOut, deadline)
    ).wait();

    expect(await tokenB.balanceOf(await trader.getAddress())).to.equal(
      traderBalanceBefore + expectedOut,
    );
    expect(await swap.reserveA()).to.equal(parseUnits("1010", 18));
    expect(await swap.reserveB()).to.equal(parseUnits("1000", 18) - expectedOut);
  });

  it("reverts when the calculated output is below minAmountOut", async function () {
    const { tokenA, swap } = await deployPool();
    const amountIn = parseUnits("10", 18);
    const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
    const deadline = (await latestTimestamp(provider)) + 60n;

    await expectRevert(async () => {
      await swap
        .connect(trader)
        .swap.staticCall(await tokenA.getAddress(), amountIn, expectedOut + 1n, deadline);
    }, "Slippage exceeded");
  });

  it("reverts stale swaps after the deadline", async function () {
    const { tokenA, swap } = await deployPool();
    const amountIn = parseUnits("1", 18);
    const expectedOut = await swap.getAmountOut(await tokenA.getAddress(), amountIn);
    const expiredDeadline = (await latestTimestamp(provider)) - 1n;

    await expectRevert(async () => {
      await swap
        .connect(trader)
        .swap.staticCall(await tokenA.getAddress(), amountIn, expectedOut, expiredDeadline);
    }, "Deadline expired");
  });

  it("uses fixed-point fee math so small fee-bearing swaps do not round to zero", async function () {
    const { tokenA, swap } = await deployPool();

    expect(await swap.calculateFee(1n)).to.equal(1n);
    expect(await swap.calculateFee(333n)).to.equal(1n);
    expect(await swap.calculateFee(334n)).to.equal(2n);

    await expectRevert(async () => {
      await swap.getAmountOut(await tokenA.getAddress(), 1n);
    }, "Amount too small");
  });
});
