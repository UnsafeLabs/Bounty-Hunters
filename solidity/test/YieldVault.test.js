const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ganache = require('ganache');
const solc = require('solc');
const { ethers } = require('ethers');

const ONE = 10n ** 18n;
const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts');
const NODE_MODULES_DIR = path.join(__dirname, '..', 'node_modules');

function readSource(file) {
  return fs.readFileSync(path.join(CONTRACTS_DIR, file), 'utf8');
}

function resolveImport(importPath) {
  const candidates = [
    path.join(NODE_MODULES_DIR, importPath),
    path.join(CONTRACTS_DIR, importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, 'utf8') };
    }
  }

  return { error: `File not found: ${importPath}` };
}

function compileContracts() {
  const input = {
    language: 'Solidity',
    sources: {
      'contracts/YieldVault.sol': { content: readSource('YieldVault.sol') },
      'contracts/MockERC20.sol': { content: readSource('MockERC20.sol') },
    },
    settings: {
      evmVersion: 'paris',
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepStrictEqual(errors, []);

  return {
    YieldVault: output.contracts['contracts/YieldVault.sol'].YieldVault,
    MockERC20: output.contracts['contracts/MockERC20.sol'].MockERC20,
  };
}

async function deploy(compiled, signer, args = []) {
  const factory = new ethers.ContractFactory(compiled.abi, compiled.evm.bytecode.object, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function increaseTime(provider, seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

async function latestTimestamp(provider) {
  const block = await provider.getBlock('latest');
  return BigInt(block.timestamp);
}

describe('YieldVault reward accounting', function () {
  this.timeout(30000);

  let compiled;
  let provider;
  let distributor;
  let staker;
  let secondStaker;
  let attacker;
  let stakingToken;
  let rewardToken;
  let vault;

  before(function () {
    compiled = compileContracts();
  });

  beforeEach(async function () {
    const ganacheProvider = ganache.provider({ chain: { hardfork: 'shanghai' }, logging: { quiet: true } });
    provider = new ethers.BrowserProvider(ganacheProvider);
    [distributor, staker, secondStaker, attacker] = await Promise.all(
      [0, 1, 2, 3].map((index) => provider.getSigner(index))
    );

    stakingToken = await deploy(compiled.MockERC20, distributor, ['Stake', 'STK']);
    rewardToken = await deploy(compiled.MockERC20, distributor, ['Reward', 'RWD']);
    vault = await deploy(compiled.YieldVault, distributor, [
      await stakingToken.getAddress(),
      await rewardToken.getAddress(),
    ]);

    for (const signer of [staker, secondStaker]) {
      await (await stakingToken.mint(await signer.getAddress(), 1_000n * ONE)).wait();
      await (await stakingToken.connect(signer).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
    }
    await (await rewardToken.mint(await vault.getAddress(), 1_000n * ONE)).wait();
  });

  it('accrues rewards during the active reward period', async function () {
    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();

    await increaseTime(provider, 40);

    const earned = await vault.earned(await staker.getAddress());
    assert(earned >= 39n * ONE && earned <= 41n * ONE, `unexpected earned amount: ${earned}`);
  });

  it('reports exact rewardPerToken values during and after the reward period', async function () {
    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();

    await increaseTime(provider, 25);

    const periodStart = await vault.periodStart();
    const elapsed = (await vault.lastTimeRewardApplicable()) - periodStart;
    const expectedDuringPeriod = elapsed * ONE / 10n;

    assert.strictEqual((await vault.rewardPerToken()).toString(), expectedDuringPeriod.toString());

    await increaseTime(provider, 200);

    assert.strictEqual((await vault.rewardPerToken()).toString(), (10n * ONE).toString());
  });

  it('freezes rewardPerToken and earned after period expiry', async function () {
    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();

    await increaseTime(provider, 150);
    const rewardPerTokenAfterExpiry = await vault.rewardPerToken();
    const earnedAfterExpiry = await vault.earned(await staker.getAddress());

    await increaseTime(provider, 500);

    assert.strictEqual((await vault.rewardPerToken()).toString(), rewardPerTokenAfterExpiry.toString());
    assert.strictEqual((await vault.earned(await staker.getAddress())).toString(), earnedAfterExpiry.toString());
  });

  it('does not grant phantom rewards to a first depositor after the period expired', async function () {
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    await increaseTime(provider, 150);

    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    const initialEarned = await vault.earned(await staker.getAddress());
    await increaseTime(provider, 500);

    assert.strictEqual(initialEarned.toString(), '0');
    assert.strictEqual((await vault.earned(await staker.getAddress())).toString(), '0');
  });

  it('does not grant pre-deposit rewards to a first depositor during an active period', async function () {
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    await increaseTime(provider, 40);

    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    await increaseTime(provider, 60);

    const earned = await vault.earned(await staker.getAddress());
    assert(earned >= 59n * ONE && earned <= 61n * ONE, `unexpected active-period reward: ${earned}`);
  });

  it('rejects unauthorized reward notifications', async function () {
    await assert.rejects(
      vault.connect(attacker).notifyRewardAmount(100n * ONE, 100),
      /Not reward distributor|missing revert data|execution reverted/
    );
  });

  it('rejects zero-duration reward periods', async function () {
    await assert.rejects(
      vault.connect(distributor).notifyRewardAmount(100n * ONE, 0),
      /Duration must be positive|missing revert data|execution reverted/
    );
  });

  it('carries reward-rate remainders so tiny rewards stay below 0.01% error', async function () {
    await (await stakingToken.mint(await attacker.getAddress(), 1n)).wait();
    await (await stakingToken.connect(attacker).approve(await vault.getAddress(), 1n)).wait();
    await (await rewardToken.mint(await vault.getAddress(), 10n)).wait();

    await (await vault.connect(attacker).deposit(1n)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(10n, 3)).wait();
    await increaseTime(provider, 3);

    const earned = await vault.earned(await attacker.getAddress());
    const expected = 10n;
    const error = expected > earned ? expected - earned : earned - expected;

    assert(error * 10_000n < expected, `precision error too high: ${error} wei`);
  });

  it('carries undistributed rewards into a replacement reward period', async function () {
    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    await increaseTime(provider, 40);

    await (await vault.connect(distributor).notifyRewardAmount(30n * ONE, 90)).wait();
    await increaseTime(provider, 90);

    const earned = await vault.earned(await staker.getAddress());
    assert(earned >= 128n * ONE && earned <= 131n * ONE, `unexpected carried reward: ${earned}`);
  });

  it('keeps pre-replacement rewards with existing stakers before splitting the carried period', async function () {
    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    await increaseTime(provider, 40);

    await (await vault.connect(distributor).notifyRewardAmount(30n * ONE, 90)).wait();
    await (await vault.connect(secondStaker).deposit(10n * ONE)).wait();
    await increaseTime(provider, 90);

    const firstEarned = await vault.earned(await staker.getAddress());
    const secondEarned = await vault.earned(await secondStaker.getAddress());

    assert(firstEarned >= 83n * ONE && firstEarned <= 87n * ONE, `unexpected first reward: ${firstEarned}`);
    assert(secondEarned >= 43n * ONE && secondEarned <= 47n * ONE, `unexpected second reward: ${secondEarned}`);
    assert(firstEarned > secondEarned, 'existing staker should retain pre-replacement rewards');
  });

  it('preserves deposit, withdrawal, and reward claim flows', async function () {
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    await (await vault.connect(staker).deposit(20n * ONE)).wait();
    await increaseTime(provider, 25);
    await (await vault.connect(secondStaker).deposit(20n * ONE)).wait();
    await increaseTime(provider, 25);
    await (await vault.connect(staker).withdraw(5n * ONE)).wait();

    const before = await rewardToken.balanceOf(await staker.getAddress());
    await (await vault.connect(staker).claimReward()).wait();
    const after = await rewardToken.balanceOf(await staker.getAddress());

    assert(after > before, 'staker should receive rewards');
    assert.strictEqual((await vault.balanceOf(await staker.getAddress())).toString(), (15n * ONE).toString());
  });

  it('exposes the active period boundary used for capped accrual', async function () {
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    const finish = await vault.periodFinish();
    assert((await vault.lastTimeRewardApplicable()) <= finish);

    await increaseTime(provider, 150);

    assert.strictEqual((await vault.lastTimeRewardApplicable()).toString(), finish.toString());
    assert(BigInt(await latestTimestamp(provider)) > finish);
  });
});
