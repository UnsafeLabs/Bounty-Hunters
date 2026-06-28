const { expect } = require("chai");
const { ethers } = require("ethers");
const ganache = require("ganache");
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const rootDir = path.join(__dirname, "..");
const parseEther = ethers.parseEther;

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
      "contracts/GovernanceToken.sol": {
        content: readSource("contracts/GovernanceToken.sol"),
      },
      "contracts/LiquidityPool.sol": {
        content: readSource("contracts/LiquidityPool.sol"),
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

async function expectRevert(promiseFactory) {
  try {
    await promiseFactory();
  } catch (error) {
    expect(error).to.exist;
    return;
  }
  throw new Error("Expected transaction to revert");
}

describe("LiquidityPool minimum liquidity and reserve accounting", function () {
  let contracts;
  let tokenArtifact;
  let poolArtifact;
  let provider;
  let owner;
  let firstProvider;
  let secondProvider;
  let donor;

  before(function () {
    contracts = compileContracts();
    tokenArtifact = getArtifact(contracts, "contracts/GovernanceToken.sol", "GovernanceToken");
    poolArtifact = getArtifact(contracts, "contracts/LiquidityPool.sol", "LiquidityPool");
  });

  beforeEach(async function () {
    const ganacheProvider = ganache.provider({ logging: { quiet: true } });
    provider = new ethers.BrowserProvider(ganacheProvider);
    owner = await provider.getSigner(0);
    firstProvider = await provider.getSigner(1);
    secondProvider = await provider.getSigner(2);
    donor = await provider.getSigner(3);
  });

  async function deployPoolFixture() {
    const tokenA = await deploy(owner, tokenArtifact, [parseEther("1000000")]);
    const tokenB = await deploy(owner, tokenArtifact, [parseEther("1000000")]);
    const pool = await deploy(owner, poolArtifact, [
      await tokenA.getAddress(),
      await tokenB.getAddress(),
    ]);

    for (const signer of [firstProvider, secondProvider, donor]) {
      await (await tokenA.transfer(await signer.getAddress(), parseEther("10000"))).wait();
      await (await tokenB.transfer(await signer.getAddress(), parseEther("10000"))).wait();
    }

    return { tokenA, tokenB, pool };
  }

  async function approveAndAdd(signer, tokenA, tokenB, pool, amountA, amountB) {
    await (await tokenA.connect(signer).approve(await pool.getAddress(), amountA)).wait();
    await (await tokenB.connect(signer).approve(await pool.getAddress(), amountB)).wait();
    await (await pool.connect(signer).addLiquidity(amountA, amountB)).wait();
  }

  it("locks MINIMUM_LIQUIDITY on the first deposit", async function () {
    const { tokenA, tokenB, pool } = await deployPoolFixture();
    const amount = parseEther("1000");
    const minimumLiquidity = await pool.MINIMUM_LIQUIDITY();

    await approveAndAdd(firstProvider, tokenA, tokenB, pool, amount, amount);

    expect(await pool.balanceOf(ethers.ZeroAddress)).to.equal(minimumLiquidity);
    expect(await pool.totalSupply()).to.equal(amount);
    expect(await pool.balanceOf(await firstProvider.getAddress())).to.equal(
      amount - minimumLiquidity,
    );
    expect(await pool.reserveA()).to.equal(amount);
    expect(await pool.reserveB()).to.equal(amount);
  });

  it("rejects tiny first deposits that cannot cover the permanent lock", async function () {
    const { tokenA, tokenB, pool } = await deployPoolFixture();

    await (await tokenA.connect(firstProvider).approve(await pool.getAddress(), 10n)).wait();
    await (await tokenB.connect(firstProvider).approve(await pool.getAddress(), 10n)).wait();

    await expectRevert(async () => {
      await (await pool.connect(firstProvider).addLiquidity(10n, 10n)).wait();
    });
  });

  it("mints proportional LP tokens for later deposits", async function () {
    const { tokenA, tokenB, pool } = await deployPoolFixture();
    const initial = parseEther("1000");
    const second = parseEther("100");

    await approveAndAdd(firstProvider, tokenA, tokenB, pool, initial, initial);
    await approveAndAdd(secondProvider, tokenA, tokenB, pool, second, second);

    expect(await pool.balanceOf(await secondProvider.getAddress())).to.equal(second);
    expect(await pool.totalSupply()).to.equal(initial + second);
    expect(await pool.reserveA()).to.equal(initial + second);
    expect(await pool.reserveB()).to.equal(initial + second);
  });

  it("does not let direct token donations alter removeLiquidity pricing", async function () {
    const { tokenA, tokenB, pool } = await deployPoolFixture();
    const initial = parseEther("1000");
    const second = parseEther("100");
    const donation = parseEther("500");
    const secondAddress = await secondProvider.getAddress();

    await approveAndAdd(firstProvider, tokenA, tokenB, pool, initial, initial);
    await approveAndAdd(secondProvider, tokenA, tokenB, pool, second, second);
    await (await tokenA.connect(donor).transfer(await pool.getAddress(), donation)).wait();

    const tokenABefore = await tokenA.balanceOf(secondAddress);
    const tokenBBefore = await tokenB.balanceOf(secondAddress);
    await (await pool.connect(secondProvider).removeLiquidity(second)).wait();

    expect((await tokenA.balanceOf(secondAddress)) - tokenABefore).to.equal(second);
    expect((await tokenB.balanceOf(secondAddress)) - tokenBBefore).to.equal(second);
    expect(await pool.reserveA()).to.equal(initial);
    expect(await pool.reserveB()).to.equal(initial);
  });

  it("sync updates reserves to recover after token donations", async function () {
    const { tokenA, tokenB, pool } = await deployPoolFixture();
    const initial = parseEther("1000");
    const donation = parseEther("500");

    await approveAndAdd(firstProvider, tokenA, tokenB, pool, initial, initial);
    await (await tokenA.connect(donor).transfer(await pool.getAddress(), donation)).wait();
    const receipt = await (await pool.sync()).wait();
    const syncEvent = receipt.logs
      .map((log) => pool.interface.parseLog(log))
      .find((log) => log && log.name === "Sync");

    expect(syncEvent.args.reserveA).to.equal(initial + donation);
    expect(syncEvent.args.reserveB).to.equal(initial);
    expect(await pool.reserveA()).to.equal(initial + donation);
    expect(await pool.reserveB()).to.equal(initial);
  });
});
