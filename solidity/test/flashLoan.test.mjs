import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ganache from "ganache";
import solc from "solc";
import { BrowserProvider, ContractFactory, parseUnits } from "ethers";

const root = process.cwd();
const flashLoanPath = path.join(root, "contracts", "FlashLoan.sol");

const testContractsSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IFlashLoanLike {
    function flashLoan(uint256 amount, bytes calldata data) external;
}

contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) internal balances;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        totalSupply += amount;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return balances[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "insufficient balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balances[from] >= amount, "insufficient balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }
}

contract BalanceOverrideToken is MockERC20 {
    mapping(address => uint256) public balanceOverride;

    function setBalanceOverride(address account, uint256 amount) external {
        balanceOverride[account] = amount;
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 overridden = balanceOverride[account];
        if (overridden != 0) {
            return overridden;
        }
        return super.balanceOf(account);
    }
}

contract FlashBorrower {
    IERC20Like public immutable token;
    IFlashLoanLike public immutable lender;
    uint256 public lastFee;

    constructor(address token_, address lender_) {
        token = IERC20Like(token_);
        lender = IFlashLoanLike(lender_);
    }

    function execute(uint256 amount) external {
        lender.flashLoan(amount, "");
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external {
        require(msg.sender == address(lender), "not lender");
        lastFee = fee;
        require(token.approve(msg.sender, amount + fee), "approve failed");
    }
}

contract ManipulativeBorrower {
    BalanceOverrideToken public immutable token;
    IFlashLoanLike public immutable lender;

    constructor(address token_, address lender_) {
        token = BalanceOverrideToken(token_);
        lender = IFlashLoanLike(lender_);
    }

    function execute(uint256 amount) external {
        lender.flashLoan(amount, "");
    }

    function onFlashLoan(address, uint256, uint256, bytes calldata) external {
        require(msg.sender == address(lender), "not lender");
        token.setBalanceOverride(msg.sender, type(uint256).max);
    }
}
`;

function findImport(importPath) {
  const candidates = [
    path.join(root, importPath),
    path.join(root, "node_modules", importPath),
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
      "contracts/FlashLoan.sol": {
        content: fs.readFileSync(flashLoanPath, "utf8"),
      },
      "test/TestContracts.sol": {
        content: testContractsSource,
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
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
  return output.contracts;
}

const contracts = compileContracts();

function artifact(source, name) {
  const compiled = contracts[source][name];
  return {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
  };
}

async function deploy(signer, source, name, args = []) {
  const { abi, bytecode } = artifact(source, name);
  const factory = new ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

describe("FlashLoan", function () {
  let provider;
  let owner;
  let user;

  beforeEach(async function () {
    provider = new BrowserProvider(ganache.provider({ logging: { quiet: true } }));
    [owner, user] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);
  });

  async function deployFundedPool({ feeBPS = 1n, tokenName = "MockERC20" } = {}) {
    const token = await deploy(owner, "test/TestContracts.sol", tokenName);
    const flashLoan = await deploy(owner, "contracts/FlashLoan.sol", "FlashLoan", [
      await token.getAddress(),
      feeBPS,
    ]);
    const ownerAddress = await owner.getAddress();
    const principal = parseUnits("1000", 18);

    await (await token.mint(ownerAddress, principal)).wait();
    await (await token.approve(await flashLoan.getAddress(), principal)).wait();
    await (await flashLoan.depositToPool(principal)).wait();

    return { token, flashLoan, principal };
  }

  it("charges at least one token unit for a nonzero flash loan", async function () {
    const { token, flashLoan } = await deployFundedPool({ feeBPS: 1n });
    const borrower = await deploy(user, "test/TestContracts.sol", "FlashBorrower", [
      await token.getAddress(),
      await flashLoan.getAddress(),
    ]);
    await (await token.mint(await borrower.getAddress(), 1n)).wait();

    await (await borrower.connect(user).execute(1n)).wait();

    assert.equal(await borrower.lastFee(), 1n);
    assert.equal(await flashLoan.totalFees(), 1n);
  });

  it("rejects flash loans above half of internally accounted pool principal", async function () {
    const { flashLoan, principal } = await deployFundedPool();

    await assert.rejects(
      flashLoan.flashLoan(principal / 2n + 1n, "0x")
    );
  });

  it("keeps fees separate from pool principal in normal flash loan flow", async function () {
    const { token, flashLoan, principal } = await deployFundedPool({ feeBPS: 100n });
    const borrower = await deploy(user, "test/TestContracts.sol", "FlashBorrower", [
      await token.getAddress(),
      await flashLoan.getAddress(),
    ]);
    const amount = parseUnits("100", 18);
    const expectedFee = parseUnits("1", 18);
    await (await token.mint(await borrower.getAddress(), expectedFee)).wait();

    await (await borrower.connect(user).execute(amount)).wait();

    assert.equal(await flashLoan.getPoolBalance(), principal);
    assert.equal(await flashLoan.totalFees(), expectedFee);
    assert.equal(await token.balanceOf(await flashLoan.getAddress()), principal + expectedFee);
  });

  it("does not let balance manipulation fake repayment or corrupt accounting", async function () {
    const { token, flashLoan, principal } = await deployFundedPool({
      feeBPS: 100n,
      tokenName: "BalanceOverrideToken",
    });
    const manipulator = await deploy(user, "test/TestContracts.sol", "ManipulativeBorrower", [
      await token.getAddress(),
      await flashLoan.getAddress(),
    ]);

    await assert.rejects(
      manipulator.connect(user).execute(parseUnits("100", 18))
    );
    assert.equal(await flashLoan.getPoolBalance(), principal);
    assert.equal(await flashLoan.totalFees(), 0n);
  });

  it("lets the owner pause and unpause flash loans", async function () {
    const { token, flashLoan } = await deployFundedPool();
    const borrower = await deploy(user, "test/TestContracts.sol", "FlashBorrower", [
      await token.getAddress(),
      await flashLoan.getAddress(),
    ]);
    const amount = parseUnits("1", 18);
    const expectedFee = parseUnits("0.0001", 18);
    await (await token.mint(await borrower.getAddress(), expectedFee)).wait();

    await (await flashLoan.pause()).wait();
    assert.equal(await flashLoan.paused(), true);
    await assert.rejects(borrower.connect(user).execute(1n));

    await (await flashLoan.unpause()).wait();
    assert.equal(await flashLoan.paused(), false);
    await (await borrower.connect(user).execute(amount)).wait();
    assert.equal(await flashLoan.totalFees(), expectedFee);
  });
});
