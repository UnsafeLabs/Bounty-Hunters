const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const contractPath = path.join(__dirname, "..", "contracts", "StakingVault.sol");
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
const reentrancyGuard = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private status;

    constructor() {
        status = NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(status != ENTERED, "ReentrancyGuard: reentrant call");
        status = ENTERED;
        _;
        status = NOT_ENTERED;
    }
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
      "contracts/StakingVault.sol": { content: source },
      "@openzeppelin/contracts/token/ERC20/IERC20.sol": { content: ierc20 },
      "@openzeppelin/contracts/utils/ReentrancyGuard.sol": { content: reentrancyGuard },
      "test/StakingVaultHarness.sol": {
        content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../contracts/StakingVault.sol";

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

contract ReentrantWithdrawer {
    StakingVault private immutable vault;
    IERC20 private immutable token;
    bool private entered;
    uint256 private attackAmount;

    constructor(StakingVault vault_, IERC20 token_) {
        vault = vault_;
        token = token_;
    }

    function stake(uint256 amount) external {
        token.approve(address(vault), amount);
        vault.stake(amount);
    }

    function attackWithdraw(uint256 amount) external {
        attackAmount = amount;
        vault.withdraw(amount);
    }

    receive() external payable {
        if (!entered) {
            entered = true;
            vault.withdraw(attackAmount);
        }
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

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath) => {
        if (importPath === "../contracts/StakingVault.sol") {
          return { contents: source };
        }
        if (importPath === "@openzeppelin/contracts/token/ERC20/IERC20.sol") {
          return { contents: ierc20 };
        }
        if (importPath === "@openzeppelin/contracts/utils/ReentrancyGuard.sol") {
          return { contents: reentrancyGuard };
        }
        return { error: `Unable to resolve import: ${importPath}` };
      },
    }),
  );
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(name, signer, args = []) {
  const artifact =
    compiled["contracts/StakingVault.sol"]?.[name] ??
    compiled["test/StakingVaultHarness.sol"][name];
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    signer,
  );
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function increaseTime(seconds) {
  await provider.send("evm_increaseTime", [Number(seconds)]);
  await provider.send("evm_mine", []);
}

async function deployVault() {
  const [owner, staker] = accounts;
  const token = await deploy("MockERC20", owner);
  const vault = await deploy("StakingVault", owner, [await token.getAddress(), 10n ** 15n]);
  await (await owner.sendTransaction({
    to: await vault.getAddress(),
    value: ethers.parseEther("20"),
  })).wait();
  await (await token.mint(staker.address, ethers.parseEther("10"))).wait();
  await (await token.connect(staker).approve(
    await vault.getAddress(),
    ethers.parseEther("10"),
  )).wait();
  return { owner, staker, token, vault };
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

test("withdraw updates state before transferring ETH", async () => {
  const { staker, vault } = await deployVault();
  const amount = ethers.parseEther("2");

  await (await vault.connect(staker).stake(amount)).wait();
  await (await vault.connect(staker).withdraw(amount)).wait();

  assert.equal(await vault.balances(staker.address), 0n);
  assert.equal(await vault.totalStaked(), 0n);
});

test("claimRewards clears rewards before transferring ETH", async () => {
  const { staker, vault } = await deployVault();
  const amount = ethers.parseEther("2");

  await (await vault.connect(staker).stake(amount)).wait();
  await increaseTime(10);
  const pending = await vault.getPendingRewards(staker.address);
  await (await vault.connect(staker).claimRewards()).wait();

  assert(pending > 0n);
  assert.equal(await vault.rewards(staker.address), 0n);
});

test("malicious withdraw reentrancy attempt fails and preserves stake", async () => {
  const { owner, token, vault } = await deployVault();
  const attacker = await deploy("ReentrantWithdrawer", owner, [
    await vault.getAddress(),
    await token.getAddress(),
  ]);
  const amount = ethers.parseEther("1");

  await (await token.mint(await attacker.getAddress(), amount)).wait();
  await (await attacker.stake(amount)).wait();

  await assert.rejects(attacker.attackWithdraw(amount));
  assert.equal(await vault.balances(await attacker.getAddress()), amount);
  assert.equal(await vault.totalStaked(), amount);
});
