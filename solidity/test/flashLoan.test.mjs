import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const externalModules = process.env.SOLIDITY_TEST_NODE_MODULES;
const require = createRequire(
  externalModules
    ? path.join(externalModules, "package.json")
    : import.meta.url
);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const solidityDir = path.resolve(testDir, "..");
const repoRoot = path.resolve(solidityDir, "..");
const externalRoot = externalModules
  ? path.join(externalModules, "node_modules")
  : path.join(solidityDir, "node_modules");

const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const flashLoanSource = fs.readFileSync(
  path.join(solidityDir, "contracts", "FlashLoan.sol"),
  "utf8"
);

const harnessSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IFlashLender {
    function flashLoan(uint256 amount, bytes calldata data) external;
}

contract MockToken is ERC20 {
    constructor() ERC20("Loan Token", "LOAN") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GoodBorrower {
    IFlashLender public lender;
    IERC20 public token;
    uint256 public lastAmount;
    uint256 public lastFee;

    constructor(address _lender, address _token) {
        lender = IFlashLender(_lender);
        token = IERC20(_token);
    }

    function execute(uint256 amount) external {
        lender.flashLoan(amount, "");
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external {
        lastAmount = amount;
        lastFee = fee;
        token.approve(msg.sender, amount + fee);
    }
}

contract DirectRepayer {
    IFlashLender public lender;
    IERC20 public token;

    constructor(address _lender, address _token) {
        lender = IFlashLender(_lender);
        token = IERC20(_token);
    }

    function execute(uint256 amount) external {
        lender.flashLoan(amount, "");
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external {
        token.transfer(msg.sender, amount + fee);
    }
}

contract ReentrantBorrower {
    IFlashLender public lender;
    IERC20 public token;

    constructor(address _lender, address _token) {
        lender = IFlashLender(_lender);
        token = IERC20(_token);
    }

    function execute(uint256 amount) external {
        lender.flashLoan(amount, abi.encode(amount));
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata data) external {
        if (data.length > 0) {
            lender.flashLoan(abi.decode(data, (uint256)), "");
        }
        token.approve(msg.sender, amount + fee);
    }
}
`;

function findImport(importPath) {
  const candidates = [
    path.join(repoRoot, importPath),
    path.join(externalRoot, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `Import not found: ${importPath}` };
}

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "FlashLoan.sol": { content: flashLoanSource },
      "Harness.sol": { content: harnessSource },
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
    solc.compile(JSON.stringify(input), { import: findImport })
  );
  const errors = (output.errors ?? []).filter(
    (error) => error.severity === "error"
  );
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
  return output.contracts;
}

async function deploy(factory, signer, ...args) {
  const contract = await factory.connect(signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRejects(promise, expectedMessage) {
  await assert.rejects(
    promise,
    (error) => String(error).includes(expectedMessage),
    `Expected revert containing ${expectedMessage}`
  );
}

async function expectAnyRejects(promise, description) {
  await assert.rejects(promise, undefined, description);
}

async function setup(feeBPS = 1) {
  const contracts = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true } })
  );
  const [owner, depositor, other] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
    provider.getSigner(2),
  ]);

  const tokenArtifact = contracts["Harness.sol"].MockToken;
  const loanArtifact = contracts["FlashLoan.sol"].FlashLoan;
  const goodArtifact = contracts["Harness.sol"].GoodBorrower;
  const directArtifact = contracts["Harness.sol"].DirectRepayer;
  const reentrantArtifact = contracts["Harness.sol"].ReentrantBorrower;

  const Token = new ethers.ContractFactory(
    tokenArtifact.abi,
    tokenArtifact.evm.bytecode.object,
    owner
  );
  const Loan = new ethers.ContractFactory(
    loanArtifact.abi,
    loanArtifact.evm.bytecode.object,
    owner
  );
  const GoodBorrower = new ethers.ContractFactory(
    goodArtifact.abi,
    goodArtifact.evm.bytecode.object,
    owner
  );
  const DirectRepayer = new ethers.ContractFactory(
    directArtifact.abi,
    directArtifact.evm.bytecode.object,
    owner
  );
  const ReentrantBorrower = new ethers.ContractFactory(
    reentrantArtifact.abi,
    reentrantArtifact.evm.bytecode.object,
    owner
  );

  const token = await deploy(Token, owner);
  const loan = await deploy(Loan, owner, await token.getAddress(), feeBPS);
  const depositAmount = 10_000n;

  await (await token.mint(await depositor.getAddress(), depositAmount)).wait();
  await (await token.connect(depositor).approve(await loan.getAddress(), depositAmount)).wait();
  await (await loan.connect(depositor).depositToPool(depositAmount)).wait();

  const good = await deploy(GoodBorrower, owner, await loan.getAddress(), await token.getAddress());
  const direct = await deploy(DirectRepayer, owner, await loan.getAddress(), await token.getAddress());
  const reentrant = await deploy(ReentrantBorrower, owner, await loan.getAddress(), await token.getAddress());

  for (const borrower of [good, direct, reentrant]) {
    await (await token.mint(await borrower.getAddress(), 1_000n)).wait();
  }

  return { owner, depositor, other, token, loan, good, direct, reentrant };
}

async function run() {
  {
    const { token, loan, good } = await setup(1);
    assert.equal(await loan.calculateFee(1), 1n);

    await (await good.execute(1)).wait();
    assert.equal(await good.lastFee(), 1n);
    assert.equal(await loan.totalFees(), 1n);
    assert.equal(await loan.getPoolBalance(), 10_001n);
    assert.equal(await token.balanceOf(await good.getAddress()), 999n);
  }

  {
    const { loan, good } = await setup(100);
    assert.equal(await loan.maxLoanAmount(), 5_000n);
    await expectRejects(good.execute.staticCall(5_001), "Loan exceeds cap");
    await (await good.execute(5_000)).wait();
    assert.equal(await loan.totalFees(), 50n);
  }

  {
    const { token, loan, direct } = await setup(1);
    await expectAnyRejects(
      direct.execute.staticCall(1_000),
      "direct repayment without approval must be rejected"
    );
    assert.equal(await loan.getPoolBalance(), 10_000n);
    assert.equal(await token.balanceOf(await loan.getAddress()), 10_000n);
  }

  {
    const { owner, other, loan, good } = await setup(1);
    await expectRejects(loan.connect(other).pause.staticCall(), "Not owner");
    await (await loan.connect(owner).pause()).wait();
    await expectRejects(good.execute.staticCall(100), "Paused");
    await (await loan.connect(owner).unpause()).wait();
    await (await good.execute(100)).wait();
  }

  {
    const { token, loan, good, owner } = await setup(100);
    await (await good.execute(1_000)).wait();
    assert.equal(await loan.totalFees(), 10n);
    assert.equal(await loan.getPoolBalance(), 10_010n);

    const before = await token.balanceOf(await owner.getAddress());
    await (await loan.withdrawFees()).wait();
    assert.equal(await loan.totalFees(), 0n);
    assert.equal(await loan.getPoolBalance(), 10_000n);
    assert.equal(await token.balanceOf(await owner.getAddress()), before + 10n);
  }

  {
    const { loan, reentrant } = await setup(100);
    await expectRejects(reentrant.execute.staticCall(100), "Active loan");
    assert.equal(await loan.getPoolBalance(), 10_000n);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
