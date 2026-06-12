const assert = require('assert');
const fs = require('fs');
const path = require('path');
const solc = require('solc');
const ganache = require('ganache');
const { ethers } = require('ethers');

const ONE = 10n ** 18n;

function compile() {
  const sources = {
    'contracts/YieldVault.sol': { content: fs.readFileSync(path.join(__dirname, '..', 'contracts', 'YieldVault.sol'), 'utf8') },
    'contracts/MockERC20.sol': { content: fs.readFileSync(path.join(__dirname, '..', 'contracts', 'MockERC20.sol'), 'utf8') },
  };
  const input = {
    language: 'Solidity',
    sources,
    settings: { evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import: (importPath) => {
      const resolved = path.join(__dirname, '..', 'node_modules', importPath);
      if (fs.existsSync(resolved)) return { contents: fs.readFileSync(resolved, 'utf8') };
      return { error: `File not found: ${importPath}` };
    },
  }));
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  assert.deepStrictEqual(errors, []);
  return {
    YieldVault: output.contracts['contracts/YieldVault.sol'].YieldVault,
    MockERC20: output.contracts['contracts/MockERC20.sol'].MockERC20,
  };
}

async function deploy(contract, signer, args = []) {
  const factory = new ethers.ContractFactory(contract.abi, contract.evm.bytecode.object, signer);
  const instance = await factory.deploy(...args);
  await instance.waitForDeployment();
  return instance;
}

async function increase(provider, seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}

describe('YieldVault reward accounting', function () {
  this.timeout(30000);

  let contracts;
  let gprovider;
  let provider;
  let distributor;
  let staker;
  let attacker;
  let stakingToken;
  let rewardToken;
  let vault;

  before(function () {
    contracts = compile();
  });

  beforeEach(async function () {
    gprovider = ganache.provider({ chain: { hardfork: 'shanghai' }, logging: { quiet: true } });
    provider = new ethers.BrowserProvider(gprovider);
    [distributor, staker, attacker] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));

    stakingToken = await deploy(contracts.MockERC20, distributor, ['Stake', 'STK']);
    rewardToken = await deploy(contracts.MockERC20, distributor, ['Reward', 'RWD']);
    vault = await deploy(contracts.YieldVault, distributor, [await stakingToken.getAddress(), await rewardToken.getAddress()]);

    await (await stakingToken.mint(await staker.getAddress(), 1_000n * ONE)).wait();
    await (await rewardToken.mint(await vault.getAddress(), 1_000n * ONE)).wait();
    await (await stakingToken.connect(staker).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
  });

  it('accrues rewards during the active reward period', async function () {
    await (await vault.connect(staker).deposit(10n * ONE)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();

    await increase(provider, 40);

    const earned = await vault.earned(await staker.getAddress());
    assert(earned >= 39n * ONE && earned <= 41n * ONE, `unexpected earned amount: ${earned}`);
  });

  it('freezes rewardPerToken and earned after period expiry', async function () {
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    await (await vault.connect(staker).deposit(10n * ONE)).wait();

    await increase(provider, 150);
    const rewardPerTokenAtExpiry = await vault.rewardPerToken();
    const earnedAtExpiry = await vault.earned(await staker.getAddress());

    await increase(provider, 500);

    assert.strictEqual((await vault.rewardPerToken()).toString(), rewardPerTokenAtExpiry.toString());
    assert.strictEqual((await vault.earned(await staker.getAddress())).toString(), earnedAtExpiry.toString());
  });

  it('rejects unauthorized notifyRewardAmount calls', async function () {
    await assert.rejects(
      vault.connect(attacker).notifyRewardAmount(100n * ONE, 100),
      /Not reward distributor|missing revert data|execution reverted/
    );
  });

  it('keeps reward-rate precision loss below 0.01%', async function () {
    await (await vault.connect(staker).deposit(1n * ONE)).wait();
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 3)).wait();

    await increase(provider, 3);
    const earned = await vault.earned(await staker.getAddress());
    const expected = 100n * ONE;
    const error = expected > earned ? expected - earned : earned - expected;

    assert(error * 10_000n < expected, `precision error too high: ${error}`);
  });

  it('preserves withdrawal and reward claim flows', async function () {
    await (await vault.connect(distributor).notifyRewardAmount(100n * ONE, 100)).wait();
    await (await vault.connect(staker).deposit(20n * ONE)).wait();
    await increase(provider, 25);
    await (await vault.connect(staker).withdraw(5n * ONE)).wait();
    await increase(provider, 25);

    const before = await rewardToken.balanceOf(await staker.getAddress());
    await (await vault.connect(staker).claimReward()).wait();
    const after = await rewardToken.balanceOf(await staker.getAddress());

    assert(after > before, 'staker should receive rewards');
    assert.strictEqual((await vault.balanceOf(await staker.getAddress())).toString(), (15n * ONE).toString());
  });
});
