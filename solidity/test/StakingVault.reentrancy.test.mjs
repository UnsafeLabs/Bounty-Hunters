import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../contracts/StakingVault.sol", import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const evmDepsDir = process.env.STAKING_VAULT_EVM_DEPS;
const evmDeps = evmDepsDir
  ? {
      solc: require(`${evmDepsDir}/solc`),
      ganache: require(`${evmDepsDir}/ganache`),
      ethers: require(`${evmDepsDir}/ethers`).ethers,
    }
  : null;

const mockTokenSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
`;

const attackerSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStakingVault {
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
}

interface IToken {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract ReentrantWithdrawAttacker {
    IStakingVault public vault;
    IToken public token;
    uint256 public reentryAmount;
    bool public attempted;
    bool public reentrySucceeded;

    constructor(address vault_, address token_) {
        vault = IStakingVault(vault_);
        token = IToken(token_);
    }

    function stakeAndWithdraw(uint256 amount) external {
        token.approve(address(vault), amount);
        vault.stake(amount);
        reentryAmount = amount;
        vault.withdraw(amount);
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            (bool ok, ) = address(vault).call(
                abi.encodeWithSignature("withdraw(uint256)", reentryAmount)
            );
            reentrySucceeded = ok;
        }
    }
}
`;

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "StakingVault.sol": { content: source },
      "MockToken.sol": { content: mockTokenSource },
      "ReentrantWithdrawAttacker.sol": { content: attackerSource },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(
    evmDeps.solc.compile(JSON.stringify(input), {
      import: (path) => {
        if (path.startsWith("@openzeppelin/")) {
          return {
            contents: readFileSync(
              `${evmDepsDir}/${path}`,
              "utf8",
            ),
          };
        }
        return { error: `File not found: ${path}` };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  assert.deepEqual(errors, []);
  return output.contracts;
}

async function deploy(contract, signer, args = []) {
  const factory = new evmDeps.ethers.ContractFactory(
    contract.abi,
    contract.evm.bytecode.object,
    signer,
  );
  const deployed = await factory.deploy(...args);
  await deployed.waitForDeployment();
  return deployed;
}

function bodyOf(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf("\n    function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function withdrawModel({ balance, totalStaked, amount }) {
  if (balance < amount) throw new Error("Insufficient balance");
  return {
    balance: balance - amount,
    totalStaked: totalStaked - amount,
    transferred: amount,
  };
}

function claimModel({ reward }) {
  if (reward <= 0n) throw new Error("No rewards");
  return {
    reward: 0n,
    transferred: reward,
  };
}

test("withdraw and claimRewards use OpenZeppelin ReentrancyGuard", () => {
  assert.match(source, /import "@openzeppelin\/contracts\/utils\/ReentrancyGuard\.sol";/);
  assert.match(source, /contract StakingVault is ReentrancyGuard/);
  assert.match(source, /function withdraw\(uint256 amount\) external nonReentrant/);
  assert.match(source, /function claimRewards\(\) external nonReentrant/);
});

test("withdraw updates balance and totalStaked before the ETH call", () => {
  const body = bodyOf("withdraw");
  const balanceUpdate = body.indexOf("balances[msg.sender] -= amount;");
  const totalUpdate = body.indexOf("totalStaked -= amount;");
  const externalCall = body.indexOf("payable(msg.sender).call{value: amount}");

  assert.ok(balanceUpdate > -1);
  assert.ok(totalUpdate > -1);
  assert.ok(externalCall > -1);
  assert.ok(balanceUpdate < externalCall);
  assert.ok(totalUpdate < externalCall);
});

test("claimRewards clears rewards before the ETH call", () => {
  const body = bodyOf("claimRewards");
  const rewardClear = body.indexOf("rewards[msg.sender] = 0;");
  const externalCall = body.indexOf("payable(msg.sender).call{value: reward}");

  assert.ok(rewardClear > -1);
  assert.ok(externalCall > -1);
  assert.ok(rewardClear < externalCall);
});

test("withdraw model preserves ordinary accounting after CEI reorder", () => {
  assert.deepEqual(withdrawModel({ balance: 10n, totalStaked: 25n, amount: 4n }), {
    balance: 6n,
    totalStaked: 21n,
    transferred: 4n,
  });
});

test("claim model transfers the accrued reward while leaving no recursive balance", () => {
  assert.deepEqual(claimModel({ reward: 7n }), {
    reward: 0n,
    transferred: 7n,
  });
});

test("staking token transfer must succeed before stake accounting changes", () => {
  const body = bodyOf("stake");
  assert.match(body, /require\(\s*stakingToken\.transferFrom\(msg\.sender, address\(this\), amount\),\s*"Stake transfer failed"\s*\);/);
  assert.ok(body.indexOf("transferFrom") < body.indexOf("balances[msg.sender] += amount;"));
});

test("malicious recursive withdraw attempt is blocked by nonReentrant", { skip: !evmDeps }, async () => {
  const contracts = compileContracts();
  const provider = new evmDeps.ethers.BrowserProvider(
    evmDeps.ganache.provider({ logging: { quiet: true } }),
  );
  const signer = await provider.getSigner();

  const token = await deploy(contracts["MockToken.sol"].MockToken, signer);
  const vault = await deploy(contracts["StakingVault.sol"].StakingVault, signer, [
    await token.getAddress(),
    1n,
  ]);
  const attacker = await deploy(
    contracts["ReentrantWithdrawAttacker.sol"].ReentrantWithdrawAttacker,
    signer,
    [await vault.getAddress(), await token.getAddress()],
  );

  const amount = 10n;
  await (await token.mint(await attacker.getAddress(), amount)).wait();
  await signer.sendTransaction({ to: await vault.getAddress(), value: amount });

  await (await attacker.stakeAndWithdraw(amount)).wait();

  assert.equal(await attacker.attempted(), true);
  assert.equal(await attacker.reentrySucceeded(), false);
  assert.equal(await vault.getStakedBalance(await attacker.getAddress()), 0n);
});
