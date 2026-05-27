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
const rootDir = path.resolve(__dirname, "..");

const mockErc20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}`;

function findImport(importPath) {
  try {
    const resolved = require.resolve(importPath, { paths: [rootDir] });
    return { contents: readFileSync(resolved, "utf8") };
  } catch (error) {
    return { error: `File not found: ${importPath}` };
  }
}

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "TokenVesting.sol": {
        content: readFileSync(path.join(rootDir, "contracts", "TokenVesting.sol"), "utf8"),
      },
      "MockERC20.sol": {
        content: mockErc20Source,
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

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
  assert.equal(errors.length, 0, errors.map((entry) => entry.formattedMessage).join("\n"));

  return {
    TokenVesting: output.contracts["TokenVesting.sol"].TokenVesting,
    MockERC20: output.contracts["MockERC20.sol"].MockERC20,
  };
}

async function increaseTime(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function deployFixture() {
  const contracts = compileContracts();
  const ganacheProvider = ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 3 },
    chain: { time: new Date("2026-01-01T00:00:00Z") },
  });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const [owner, beneficiary, other] = await provider.listAccounts();

  const tokenFactory = new ethers.ContractFactory(
    contracts.MockERC20.abi,
    contracts.MockERC20.evm.bytecode.object,
    owner,
  );
  const token = await tokenFactory.deploy("Vest Token", "VST");
  await token.waitForDeployment();

  // 1 billion tokens with 18 decimals — max allocation test
  const totalAllocation = ethers.parseEther("1000000000");
  const cliffDuration = 86400n; // 1 day
  const vestingDuration = 365n * 86400n; // 1 year
  const start = 1767225600n; // 2026-01-01T00:00:00Z matches ganache time

  const vestingFactory = new ethers.ContractFactory(
    contracts.TokenVesting.abi,
    contracts.TokenVesting.evm.bytecode.object,
    owner,
  );

  const vesting = await vestingFactory.deploy(
    token.target,
    beneficiary.address,
    totalAllocation,
    start,
    cliffDuration,
    vestingDuration,
  );
  await vesting.waitForDeployment();

  await token.mint(vesting.target, totalAllocation);

  return { provider, owner, beneficiary, other, token, vesting, totalAllocation, cliffDuration, vestingDuration, start };
}

describe("TokenVesting", function () {
  this.timeout(20000);

  it("does not overflow for 1 billion token allocation with 18 decimals", async () => {
    const { provider, beneficiary, vesting, totalAllocation, vestingDuration } = await deployFixture();

    // Advance past cliff + halfway through vesting
    await increaseTime(provider, Number(vestingDuration / 2n));
    const vested = await vesting.vestedAmount();

    // Should be approximately half of totalAllocation (within 1 token unit)
    const halfAlloc = totalAllocation / 2n;
    const tolerance = ethers.parseEther("1");
    assert.ok(
      vested >= halfAlloc - tolerance && vested <= halfAlloc + tolerance,
      `Expected ~500M tokens, got ${ethers.formatEther(vested)}`,
    );
  });

  it("returns zero vested before cliff", async () => {
    const { vesting } = await deployFixture();
    const vested = await vesting.vestedAmount();
    assert.equal(vested, 0n);
  });

  it("correctly handles revocation during cliff period", async () => {
    const { owner, beneficiary, vesting, token, totalAllocation } = await deployFixture();

    // Revoke during cliff — no tokens vested yet
    await vesting.connect(owner).revoke();

    // All tokens should go back to owner (unvested = totalAllocation since claimed=0, vested=0)
    const ownerBalance = await token.balanceOf(owner.address);
    assert.ok(ownerBalance >= totalAllocation - ethers.parseEther("1"), "Owner should get all unvested tokens");
  });

  it("correctly handles revocation after partial vesting", async () => {
    const { provider, owner, beneficiary, vesting, token, totalAllocation, vestingDuration } = await deployFixture();

    // Advance past cliff + 25% through vesting
    await increaseTime(provider, Number(vestingDuration / 4n));

    const vestedBefore = await vesting.vestedAmount();
    assert.ok(vestedBefore > 0n, "Should have some vested amount");

    await vesting.connect(owner).revoke();

    // Beneficiary should get their vested amount
    const beneficiaryBalance = await token.balanceOf(beneficiary.address);
    assert.ok(beneficiaryBalance > 0n, "Beneficiary should get vested tokens");

    // Total distributed = beneficiary + owner should equal totalAllocation
    const ownerBalance = await token.balanceOf(owner.address);
    const totalDistributed = beneficiaryBalance + ownerBalance;
    assert.ok(
      totalAllocation - totalDistributed < ethers.parseEther("1") || totalDistributed === totalAllocation,
      "All tokens should be distributed",
    );
  });

  it("vests full allocation at end of vesting period", async () => {
    const { provider, vesting, totalAllocation } = await deployFixture();

    // Advance past entire vesting period
    await increaseTime(provider, Number(365n * 86400n) + 1000);
    const vested = await vesting.vestedAmount();

    assert.equal(vested, totalAllocation);
  });

  it("remainder accuracy — total claimed equals total allocation at vesting end", async () => {
    const { provider, beneficiary, vesting, token, totalAllocation } = await deployFixture();

    // Advance to full vesting
    await increaseTime(provider, Number(365n * 86400n) + 1000);

    const claimable = await vesting.claimable();
    assert.equal(claimable, totalAllocation);

    await vesting.connect(beneficiary).claim();
    const beneficiaryBalance = await token.balanceOf(beneficiary.address);
    assert.equal(beneficiaryBalance, totalAllocation);
  });
});
