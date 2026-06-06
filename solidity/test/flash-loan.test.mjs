import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import ganache from "ganache";
import solc from "solc";
import { ethers } from "ethers";

const require = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
}

function findImports(importPath) {
  try {
    const resolvedPath = importPath.startsWith("@")
      ? require.resolve(importPath, { paths: [projectDir] })
      : path.join(projectDir, importPath);
    return { contents: fs.readFileSync(resolvedPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/FlashLoan.sol": { content: readSource("contracts/FlashLoan.sol") },
      "test/FlashLoanTestContracts.sol": { content: readSource("test/FlashLoanTestContracts.sol") },
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts;
}

function getArtifact(contracts, name) {
  for (const contractGroup of Object.values(contracts)) {
    if (contractGroup[name]) {
      return contractGroup[name];
    }
  }
  throw new Error(`Missing compiled artifact for ${name}`);
}

async function deploy(contracts, signer, name, args = []) {
  const artifact = getArtifact(contracts, name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(action, pattern) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error), pattern);
    return;
  }
  assert.fail("Expected transaction to revert");
}

const contracts = compileContracts();

async function setup({ rebasing = false } = {}) {
  const provider = new ethers.BrowserProvider(
    ganache.provider({
      logging: { quiet: true },
      wallet: { totalAccounts: 4, defaultBalance: 1000 },
    }),
  );
  const [owner] = await Promise.all([0].map((index) => provider.getSigner(index)));
  const token = rebasing
    ? await deploy(contracts, owner, "MockRebasingERC20")
    : await deploy(contracts, owner, "MockERC20", ["Loan Token", "LOAN"]);
  const lender = await deploy(contracts, owner, "FlashLoan", [await token.getAddress(), 30n]);
  const repayingBorrower = await deploy(contracts, owner, "RepayingBorrower");
  const nonRepayingBorrower = await deploy(contracts, owner, "NonRepayingRebaseBorrower");

  await (await token.mint(await owner.getAddress(), 10_000n)).wait();
  await (await token.mint(await repayingBorrower.getAddress(), 1_000n)).wait();
  await (await token.approve(await lender.getAddress(), 10_000n)).wait();
  await (await lender.depositToPool(1_000n)).wait();

  return { owner, token, lender, repayingBorrower, nonRepayingBorrower };
}

{
  const { lender, repayingBorrower } = await setup();

  assert.equal(await lender.calculateFee(1n), 1n);
  await (await repayingBorrower.execute(await lender.getAddress(), 1n)).wait();

  assert.equal(await lender.totalFees(), 1n);
  assert.equal(await lender.getPoolBalance(), 1_001n);
}

{
  const { lender, repayingBorrower } = await setup();
  const lenderAddress = await lender.getAddress();

  assert.equal(await lender.maxLoanAmount(), 500n);
  await expectRevert(
    () => repayingBorrower.execute.staticCall(lenderAddress, 501n),
    /Loan exceeds max/,
  );
}

{
  const { lender, nonRepayingBorrower } = await setup({ rebasing: true });
  const lenderAddress = await lender.getAddress();

  await expectRevert(
    () => nonRepayingBorrower.execute.staticCall(lenderAddress, 100n),
    /Loan not repaid|ERC20InsufficientAllowance|unknown custom error|CALL_EXCEPTION/,
  );
}

{
  const { lender, repayingBorrower } = await setup();
  const lenderAddress = await lender.getAddress();

  await (await lender.pause()).wait();
  await expectRevert(
    () => repayingBorrower.execute.staticCall(lenderAddress, 100n),
    /Paused/,
  );
  await (await lender.unpause()).wait();
  await (await repayingBorrower.execute(lenderAddress, 100n)).wait();

  assert.equal(await lender.totalFees(), 1n);
}

{
  const { owner, token, lender, repayingBorrower } = await setup();
  const ownerAddress = await owner.getAddress();
  const ownerBefore = await token.balanceOf(ownerAddress);

  await (await repayingBorrower.execute(await lender.getAddress(), 10_000n / 100n)).wait();
  assert.equal(await lender.totalFees(), 1n);
  assert.equal(await lender.getPoolBalance(), 1_001n);

  await (await lender.withdrawFees()).wait();

  assert.equal(await lender.totalFees(), 0n);
  assert.equal(await lender.getPoolBalance(), 1_000n);
  assert.equal((await token.balanceOf(ownerAddress)) - ownerBefore, 1n);
}

console.log("FlashLoan fee, cap, accounting, and pause regressions passed");
