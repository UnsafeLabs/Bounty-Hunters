import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";
import ganache from "ganache";
import solc from "solc";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solidityRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(solidityRoot, "..");

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BalanceOverrideToken is MockToken {
    mapping(address => uint256) public forcedBalances;

    function forceBalance(address account, uint256 amount) external {
        forcedBalances[account] = amount;
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 forced = forcedBalances[account];
        if (forced != 0) {
            return forced;
        }
        return super.balanceOf(account);
    }
}
`;

const borrowerSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IFlashLoanLike {
    function flashLoan(uint256 amount, bytes calldata data) external;
}

contract FlashBorrower {
    address public immutable lender;
    address public immutable token;

    constructor(address lender_, address token_) {
        lender = lender_;
        token = token_;
    }

    function execute(uint256 amount) external {
        IFlashLoanLike(lender).flashLoan(amount, "");
    }

    function onFlashLoan(address loanToken, uint256 amount, uint256 fee, bytes calldata) external {
        require(msg.sender == lender, "unexpected lender");
        require(loanToken == token, "unexpected token");
        IERC20Like(token).approve(lender, amount + fee);
    }
}

interface IBalanceOverrideToken is IERC20Like {
    function forceBalance(address account, uint256 amount) external;
}

contract ManipulativeBorrower {
    address public immutable lender;
    address public immutable token;

    constructor(address lender_, address token_) {
        lender = lender_;
        token = token_;
    }

    function execute(uint256 amount) external {
        IFlashLoanLike(lender).flashLoan(amount, "");
    }

    function onFlashLoan(address loanToken, uint256, uint256, bytes calldata) external {
        require(msg.sender == lender, "unexpected lender");
        require(loanToken == token, "unexpected token");
        IBalanceOverrideToken(token).forceBalance(lender, type(uint256).max);
    }
}
`;

function resolveImport(importPath) {
  if (importPath.startsWith("@openzeppelin/")) {
    const resolved = require.resolve(importPath, { paths: [solidityRoot] });
    return { contents: readFileSync(resolved, "utf8") };
  }

  const localPath = path.join(repoRoot, importPath);
  try {
    return { contents: readFileSync(localPath, "utf8") };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "solidity/contracts/FlashLoan.sol": {
        content: readFileSync(path.join(solidityRoot, "contracts", "FlashLoan.sol"), "utf8"),
      },
      "test/MockToken.sol": {
        content: mockTokenSource,
      },
      "test/FlashBorrower.sol": {
        content: borrowerSource,
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);

  return {
    lender: output.contracts["solidity/contracts/FlashLoan.sol"].FlashLoan,
    token: output.contracts["test/MockToken.sol"].MockToken,
    balanceOverrideToken: output.contracts["test/MockToken.sol"].BalanceOverrideToken,
    borrower: output.contracts["test/FlashBorrower.sol"].FlashBorrower,
    manipulativeBorrower: output.contracts["test/FlashBorrower.sol"].ManipulativeBorrower,
  };
}

async function deploy(contract, signer, args = []) {
  const factory = new ethers.ContractFactory(
    contract.abi,
    `0x${contract.evm.bytecode.object}`,
    signer,
  );
  const deployment = await factory.deploy(...args);
  await deployment.waitForDeployment();
  return deployment;
}

async function expectRevert(action, messagePattern = /revert/i) {
  try {
    await action();
  } catch (error) {
    assert.match(String(error.shortMessage ?? error.message), messagePattern);
    return;
  }
  assert.fail("Expected revert");
}

describe("FlashLoan", function () {
  let contracts;
  let provider;
  let owner;
  let other;

  before(function () {
    contracts = compileContracts();
  });

  beforeEach(async function () {
    const ganacheProvider = ganache.provider({
      chain: { chainId: 31_337 },
      logging: { quiet: true },
      wallet: { deterministic: true, totalAccounts: 4 },
    });
    provider = new ethers.BrowserProvider(ganacheProvider);
    owner = await provider.getSigner(0);
    other = await provider.getSigner(1);
  });

  async function deployFundedLender({ tokenContract = contracts.token, feeBps = 30n } = {}) {
    const token = await deploy(tokenContract, owner);
    const lender = await deploy(contracts.lender, owner, [await token.getAddress(), feeBps]);
    const poolAmount = 1_000_000n;
    await (await token.mint(await owner.getAddress(), poolAmount)).wait();
    await (await token.approve(await lender.getAddress(), poolAmount)).wait();
    await (await lender.depositToPool(poolAmount)).wait();
    return { token, lender, poolAmount };
  }

  it("charges at least one token unit on small flash loans", async function () {
    const { token, lender, poolAmount } = await deployFundedLender();
    const borrower = await deploy(contracts.borrower, owner, [
      await lender.getAddress(),
      await token.getAddress(),
    ]);
    await (await token.mint(await borrower.getAddress(), 1n)).wait();

    await (await borrower.execute(1n)).wait();

    assert.equal(await lender.totalFees(), 1n);
    assert.equal(await lender.getPoolBalance(), poolAmount);
    assert.equal(await token.balanceOf(await lender.getAddress()), poolAmount + 1n);
  });

  it("rejects loans larger than half of the tracked pool balance", async function () {
    const { lender, poolAmount } = await deployFundedLender();

    await expectRevert(
      async () => lender.flashLoan(poolAmount / 2n + 1n, "0x"),
      /Amount exceeds max loan|revert/i,
    );
  });

  it("keeps fees separate from principal accounting", async function () {
    const { token, lender, poolAmount } = await deployFundedLender({ feeBps: 100n });
    const borrower = await deploy(contracts.borrower, owner, [
      await lender.getAddress(),
      await token.getAddress(),
    ]);
    const amount = 10_000n;
    const fee = 100n;
    await (await token.mint(await borrower.getAddress(), fee)).wait();

    await (await borrower.execute(amount)).wait();

    assert.equal(await lender.getPoolBalance(), poolAmount);
    assert.equal(await lender.totalFees(), fee);

    const ownerBefore = await token.balanceOf(await owner.getAddress());
    await (await lender.withdrawFees()).wait();
    assert.equal(await lender.totalFees(), 0n);
    assert.equal(await lender.getPoolBalance(), poolAmount);
    assert.equal(await token.balanceOf(await owner.getAddress()), ownerBefore + fee);
    assert.equal(await token.balanceOf(await lender.getAddress()), poolAmount);
  });

  it("does not accept manipulated balanceOf values as repayment", async function () {
    const { token, lender } = await deployFundedLender({
      tokenContract: contracts.balanceOverrideToken,
    });
    const borrower = await deploy(contracts.manipulativeBorrower, owner, [
      await lender.getAddress(),
      await token.getAddress(),
    ]);

    await expectRevert(async () => {
      const tx = await borrower.execute(100n);
      await tx.wait();
    }, /revert/i);

    assert.equal(await lender.totalFees(), 0n);
  });

  it("lets only the owner pause and unpause flash loans", async function () {
    const { token, lender } = await deployFundedLender();
    const borrower = await deploy(contracts.borrower, owner, [
      await lender.getAddress(),
      await token.getAddress(),
    ]);
    await (await token.mint(await borrower.getAddress(), 1n)).wait();

    await expectRevert(async () => {
      const tx = await lender.connect(other).pause();
      await tx.wait();
    }, /Not owner|revert/i);

    await (await lender.pause()).wait();
    await expectRevert(async () => {
      const tx = await borrower.execute(1n);
      await tx.wait();
    }, /Paused|revert/i);

    await (await lender.unpause()).wait();
    const activeBorrower = await deploy(contracts.borrower, owner, [
      await lender.getAddress(),
      await token.getAddress(),
    ]);
    await (await token.mint(await activeBorrower.getAddress(), 1n)).wait();
    await (await activeBorrower.execute(1n)).wait();
    assert.equal(await lender.totalFees(), 1n);
  });
});
