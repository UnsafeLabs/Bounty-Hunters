const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const contractPath = path.join(__dirname, "..", "contracts", "TokenVesting.sol");
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
      "contracts/TokenVesting.sol": { content: source },
      "@openzeppelin/contracts/token/ERC20/IERC20.sol": { content: ierc20 },
      "test/MockERC20.sol": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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
    compiled["contracts/TokenVesting.sol"]?.[name] ?? compiled["test/MockERC20.sol"][name];
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

function expectedVested({ allocation, start, cliff = start, duration, timestamp }) {
  if (timestamp < cliff) return 0n;
  if (timestamp >= start + duration) return allocation;

  const elapsed = timestamp - start;
  return (allocation / duration) * elapsed + (allocation % duration) * elapsed / duration;
}

async function deployVesting({ allocation, start, cliffDuration = 0n, duration }) {
  const [owner, beneficiary] = accounts;
  const token = await deploy("MockERC20", owner);
  const vesting = await deploy("TokenVesting", owner, [
    await token.getAddress(),
    beneficiary.address,
    allocation,
    start,
    cliffDuration,
    duration,
  ]);
  await token.mint(await vesting.getAddress(), allocation);
  return { owner, beneficiary, token, vesting };
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

test("calculates large allocations without overflowing", async () => {
  const now = await latestTimestamp();
  const allocation = 1_000_000_000n * 10n ** 18n;
  const duration = 1_000n;
  const elapsed = 500n;
  const { vesting } = await deployVesting({
    allocation,
    start: now - elapsed,
    duration,
  });

  assert.equal(await vesting.vestedAmount(), allocation / 2n);
});

test("preserves remainder so full vesting reaches the total allocation", async () => {
  const now = await latestTimestamp();
  const allocation = 100n;
  const duration = 6n;
  const { beneficiary, token, vesting } = await deployVesting({
    allocation,
    start: now - duration,
    duration,
  });

  assert.equal(await vesting.vestedAmount(), allocation);
  await vesting.connect(beneficiary).claim();
  assert.equal(await token.balanceOf(beneficiary.address), allocation);
});

test("revocation during the cliff returns all unclaimed tokens to the owner", async () => {
  const now = await latestTimestamp();
  const allocation = ethers.parseEther("100");
  const { owner, beneficiary, token, vesting } = await deployVesting({
    allocation,
    start: now,
    cliffDuration: 1_000n,
    duration: 10_000n,
  });

  await vesting.revoke();

  assert.equal(await token.balanceOf(owner.address), allocation);
  assert.equal(await token.balanceOf(beneficiary.address), 0n);
});

test("post-cliff revocation pays vested tokens and returns only unvested tokens", async () => {
  const now = await latestTimestamp();
  const allocation = ethers.parseEther("100");
  const duration = 1_000n;
  const elapsed = 250n;
  const { owner, beneficiary, token, vesting } = await deployVesting({
    allocation,
    start: now - elapsed,
    duration,
  });

  const tx = await vesting.revoke();
  const receipt = await tx.wait();
  const revokeBlock = await provider.getBlock(receipt.blockNumber);
  const vested = expectedVested({
    allocation,
    start: now - elapsed,
    duration,
    timestamp: BigInt(revokeBlock.timestamp),
  });

  assert.equal(await token.balanceOf(beneficiary.address), vested);
  assert.equal(await token.balanceOf(owner.address), allocation - vested);
});

test("revocation after a partial claim returns only the remaining unvested tokens", async () => {
  const now = await latestTimestamp();
  const allocation = ethers.parseEther("100");
  const duration = 1_000n;
  const elapsed = 250n;
  const { owner, beneficiary, token, vesting } = await deployVesting({
    allocation,
    start: now - elapsed,
    duration,
  });

  await vesting.connect(beneficiary).claim();
  const tx = await vesting.revoke();
  const receipt = await tx.wait();
  const revokeBlock = await provider.getBlock(receipt.blockNumber);
  const vested = expectedVested({
    allocation,
    start: now - elapsed,
    duration,
    timestamp: BigInt(revokeBlock.timestamp),
  });

  assert.equal(await token.balanceOf(beneficiary.address), vested);
  assert.equal(await token.balanceOf(owner.address), allocation - vested);
});
