import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/FlashLoan.sol": {
        content: readFileSync(path.join(root, "contracts/FlashLoan.sol"), "utf8"),
      },
      "test/FlashLoanMocks.sol": {
        content: readFileSync(path.join(root, "test/FlashLoanMocks.sol"), "utf8"),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import: (importPath) => {
      try {
        return { contents: readFileSync(path.join(root, "node_modules", importPath), "utf8") };
      } catch {
        return { error: `Cannot resolve ${importPath}` };
      }
    },
  }));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
  return output.contracts;
}

const contracts = compileContracts();

async function deploy(contract, signer, ...args) {
  const factory = new ethers.ContractFactory(contract.abi, contract.evm.bytecode.object, signer);
  const instance = await factory.deploy(...args);
  await instance.waitForDeployment();
  return instance;
}

async function expectRevert(action, reason) {
  await assert.rejects(action, (error) => {
    assert.match(error.info?.error?.message ?? error.message, new RegExp(reason));
    return true;
  });
}

async function setup(feeBPS = 100) {
  const provider = new ethers.BrowserProvider(ganache.provider({
    logging: { quiet: true },
    chain: { hardfork: "shanghai" },
  }));
  const owner = await provider.getSigner(0);
  const other = await provider.getSigner(1);
  const token = await deploy(contracts["test/FlashLoanMocks.sol"].MockLoanToken, owner);
  const pool = await deploy(contracts["contracts/FlashLoan.sol"].FlashLoan, owner, await token.getAddress(), feeBPS);
  const borrower = await deploy(
    contracts["test/FlashLoanMocks.sol"].MockFlashBorrower,
    owner,
    await token.getAddress(),
    await pool.getAddress(),
  );

  await (await token.mint(await owner.getAddress(), 1000)).wait();
  await (await token.approve(await pool.getAddress(), 1000)).wait();
  await (await pool.depositToPool(1000)).wait();
  await (await token.mint(await borrower.getAddress(), 100)).wait();
  return { owner, other, token, pool, borrower };
}

test("small loans pay at least one token unit, even at zero basis points", async () => {
  const { token, pool, borrower } = await setup(0);
  await (await borrower.borrow(1, 0)).wait();
  assert.equal(await borrower.lastFee(), 1n);
  assert.equal(await pool.totalFees(), 1n);
  assert.equal(await pool.accountedPoolBalance(), 1001n);
  assert.equal(await token.balanceOf(await pool.getAddress()), 1001n);
});

test("the cap allows exactly half the pool and rejects a larger loan", async () => {
  const { pool, borrower } = await setup();
  assert.equal(await pool.maxLoanAmount(), 500n);
  await expectRevert(() => borrower.borrow(501, 0), "Loan exceeds 50% of pool");
  await (await borrower.borrow(500, 0)).wait();
  assert.equal(await borrower.lastFee(), 5n);
  assert.equal(await pool.accountedPoolBalance(), 1005n);
});

test("a positive rebase during the callback cannot substitute for repayment", async () => {
  const { token, pool, borrower } = await setup();
  await expectRevert(() => borrower.borrow(100, 1), "Pool changed during callback");
  assert.equal(await token.balanceOf(await pool.getAddress()), 1000n);
  assert.equal(await pool.accountedPoolBalance(), 1000n);
  assert.equal(await pool.totalFees(), 0n);
});

test("a preexisting surplus cannot increase the loan cap or fee accounting", async () => {
  const { token, pool, borrower } = await setup();
  await (await token.setReportedBonus(await pool.getAddress(), 1)).wait();
  assert.equal(await pool.maxLoanAmount(), 500n);
  await (await borrower.borrow(1, 0)).wait();
  assert.equal(await pool.accountedPoolBalance(), 1001n);
  assert.equal(await token.balanceOf(await pool.getAddress()), 1002n);
});

test("a negative rebase cannot be treated as accounted liquidity", async () => {
  const { token, pool, borrower } = await setup();
  await (await token.forceBurn(await pool.getAddress(), 1)).wait();
  await expectRevert(() => borrower.borrow(1, 0), "Pool balance below accounting");
  assert.equal(await pool.totalFees(), 0n);
});

test("pause blocks loans and only the owner can unpause them", async () => {
  const { other, pool, borrower } = await setup();
  await expectRevert(() => pool.connect(other).pause(), "Not owner");
  await (await pool.pause()).wait();
  assert.equal(await pool.paused(), true);
  await expectRevert(() => borrower.borrow(1, 0), "Paused");
  await expectRevert(() => pool.connect(other).unpause(), "Not owner");
  await (await pool.unpause()).wait();
  assert.equal(await pool.paused(), false);
  await (await borrower.borrow(1, 0, { gasLimit: 1_000_000 })).wait();
  assert.equal(await pool.totalFees(), 1n);
});

test("fees accrue in pool accounting and withdrawal preserves principal", async () => {
  const { owner, token, pool, borrower } = await setup();
  await (await borrower.borrow(1, 0)).wait();
  await (await borrower.borrow(100, 0)).wait();
  assert.equal(await pool.totalFees(), 2n);
  assert.equal(await pool.accountedPoolBalance(), 1002n);
  assert.equal(await pool.maxLoanAmount(), 501n);

  const ownerBalance = await token.balanceOf(await owner.getAddress());
  await (await pool.withdrawFees()).wait();
  assert.equal(await token.balanceOf(await owner.getAddress()), ownerBalance + 2n);
  assert.equal(await token.balanceOf(await pool.getAddress()), 1000n);
  assert.equal(await pool.accountedPoolBalance(), 1000n);
  assert.equal(await pool.totalFees(), 0n);
  assert.equal(await pool.maxLoanAmount(), 500n);
});
