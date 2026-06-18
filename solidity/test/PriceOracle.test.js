const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ganache = require('ganache');
const solc = require('solc');
const { ethers } = require('ethers');

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
      'contracts/PriceOracle.sol': { content: readSource('PriceOracle.sol') },
      'contracts/MockAggregatorV3.sol': { content: readSource('MockAggregatorV3.sol') },
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
    PriceOracle: output.contracts['contracts/PriceOracle.sol'].PriceOracle,
    MockAggregatorV3: output.contracts['contracts/MockAggregatorV3.sol'].MockAggregatorV3,
  };
}

async function deploy(compiled, signer, args = []) {
  const factory = new ethers.ContractFactory(compiled.abi, compiled.evm.bytecode.object, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function latestTimestamp(provider) {
  const block = await provider.getBlock('latest');
  return Number(block.timestamp);
}

async function setRound(feed, price, updatedAt, roundId = 1, answeredInRound = roundId) {
  await (await feed.setRoundData(roundId, price, updatedAt, updatedAt, answeredInRound)).wait();
}

async function expectRevert(promise, pattern) {
  await assert.rejects(promise, pattern);
}

function findEvent(receipt, contract, eventName) {
  return receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event && event.name === eventName);
}

describe('PriceOracle validation and fallback', function () {
  this.timeout(30000);

  let compiled;
  let provider;
  let owner;
  let attacker;
  let primaryFeed;
  let fallbackFeed;
  let oracle;

  before(function () {
    compiled = compileContracts();
  });

  beforeEach(async function () {
    const ganacheProvider = ganache.provider({ chain: { hardfork: 'shanghai' }, logging: { quiet: true } });
    provider = new ethers.BrowserProvider(ganacheProvider);
    [owner, attacker] = await Promise.all([0, 1].map((index) => provider.getSigner(index)));

    primaryFeed = await deploy(compiled.MockAggregatorV3, owner, [8]);
    fallbackFeed = await deploy(compiled.MockAggregatorV3, owner, [8]);
    oracle = await deploy(compiled.PriceOracle, owner, [await primaryFeed.getAddress()]);
    await (await oracle.setFallbackFeed(await fallbackFeed.getAddress())).wait();
  });

  it('returns a fresh positive primary price', async function () {
    const now = await latestTimestamp(provider);
    await setRound(primaryFeed, 2500_00000000n, now - 30);

    const price = await oracle.getLatestPrice.staticCall();

    assert.strictEqual(price.toString(), '250000000000');

    const receipt = await (await oracle.getLatestPrice()).wait();
    const priceEvent = findEvent(receipt, oracle, 'PriceQueried');

    assert(priceEvent, 'expected PriceQueried event');
    assert.strictEqual(priceEvent.args.price.toString(), '250000000000');
    assert.strictEqual(priceEvent.args.timestamp.toString(), String(now - 30));
  });

  it('falls back on stale primary data and emits StalePrice', async function () {
    const now = await latestTimestamp(provider);
    await setRound(primaryFeed, 1000_00000000n, now - 3600);
    await setRound(fallbackFeed, 1010_00000000n, now - 30);

    const price = await oracle.getLatestPrice.staticCall();
    assert.strictEqual(price.toString(), '101000000000');

    const receipt = await (await oracle.getLatestPrice()).wait();
    const staleEvent = findEvent(receipt, oracle, 'StalePrice');
    const priceEvent = findEvent(receipt, oracle, 'PriceQueried');

    assert(staleEvent, 'expected StalePrice event');
    assert.strictEqual(staleEvent.args.timestamp.toString(), String(now - 3600));
    assert(priceEvent, 'expected PriceQueried event');
    assert.strictEqual(priceEvent.args.price.toString(), '101000000000');
    assert.strictEqual(priceEvent.args.timestamp.toString(), String(now - 30));
  });

  it('rejects zero and negative primary prices without falling back', async function () {
    const now = await latestTimestamp(provider);
    await setRound(fallbackFeed, 1010_00000000n, now - 30);

    await setRound(primaryFeed, 0, now - 30);
    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid price|execution reverted|missing revert data/);

    await setRound(primaryFeed, -1, now - 30);
    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid price|execution reverted|missing revert data/);
  });

  it('rejects incomplete primary rounds without falling back', async function () {
    const now = await latestTimestamp(provider);
    await setRound(fallbackFeed, 1010_00000000n, now - 30);
    await setRound(primaryFeed, 1000_00000000n, now - 30, 5, 4);

    await expectRevert(oracle.getLatestPrice.staticCall(), /Incomplete round|execution reverted|missing revert data/);
  });

  it('reverts when both primary and fallback prices are stale', async function () {
    const now = await latestTimestamp(provider);
    await setRound(primaryFeed, 1000_00000000n, now - 3600);
    await setRound(fallbackFeed, 1010_00000000n, now - 7200);

    await expectRevert(oracle.getLatestPrice.staticCall(), /Stale price|execution reverted|missing revert data/);
  });

  it('reverts instead of returning stale data when no fallback feed is configured', async function () {
    const now = await latestTimestamp(provider);
    const oracleWithoutFallback = await deploy(compiled.PriceOracle, owner, [await primaryFeed.getAddress()]);
    await setRound(primaryFeed, 1000_00000000n, now - 3600);

    await expectRevert(
      oracleWithoutFallback.getLatestPrice.staticCall(),
      /Fallback not set|execution reverted|missing revert data/
    );
  });

  it('validates fallback feed responses before returning a fallback price', async function () {
    const now = await latestTimestamp(provider);
    await setRound(primaryFeed, 1000_00000000n, now - 3600);

    await setRound(fallbackFeed, 1010_00000000n, 0);
    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid timestamp|execution reverted|missing revert data/);

    await setRound(fallbackFeed, 0, now - 30);
    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid price|execution reverted|missing revert data/);

    await setRound(fallbackFeed, -1, now - 30);
    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid price|execution reverted|missing revert data/);

    await setRound(fallbackFeed, 1010_00000000n, now - 30, 3, 2);
    await expectRevert(oracle.getLatestPrice.staticCall(), /Incomplete round|execution reverted|missing revert data/);

    await setRound(fallbackFeed, 1010_00000000n, now + 86400);
    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid timestamp|execution reverted|missing revert data/);
  });

  it('rejects missing primary oracle timestamps', async function () {
    await setRound(primaryFeed, 2500_00000000n, 0);

    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid timestamp|execution reverted|missing revert data/);
  });

  it('rejects future oracle timestamps', async function () {
    const now = await latestTimestamp(provider);
    await setRound(primaryFeed, 2500_00000000n, now + 86400);

    await expectRevert(oracle.getLatestPrice.staticCall(), /Invalid timestamp|execution reverted|missing revert data/);
  });

  it('lets only the owner configure max staleness', async function () {
    await expectRevert(
      oracle.connect(attacker).setMaxStaleness(120),
      /Not owner|execution reverted|missing revert data/
    );

    const receipt = await (await oracle.setMaxStaleness(120)).wait();
    const event = findEvent(receipt, oracle, 'MaxStalenessUpdated');
    assert(event, 'expected MaxStalenessUpdated event');
    assert.strictEqual(event.args.maxStaleness.toString(), '120');

    await expectRevert(oracle.setMaxStaleness(0), /Invalid staleness|execution reverted|missing revert data/);

    const now = await latestTimestamp(provider);
    await setRound(primaryFeed, 2500_00000000n, now - 119);
    assert.strictEqual((await oracle.getLatestPrice.staticCall()).toString(), '250000000000');

    await setRound(primaryFeed, 2500_00000000n, now - 120);
    await setRound(fallbackFeed, 2600_00000000n, now - 10);
    assert.strictEqual((await oracle.getLatestPrice.staticCall()).toString(), '260000000000');
  });

  it('lets only the owner configure a decimals-compatible fallback feed', async function () {
    const mismatchedFeed = await deploy(compiled.MockAggregatorV3, owner, [18]);
    const replacementFeed = await deploy(compiled.MockAggregatorV3, owner, [8]);

    await expectRevert(
      deploy(compiled.PriceOracle, owner, [ethers.ZeroAddress]),
      /Invalid primary feed|execution reverted|missing revert data/
    );
    await expectRevert(oracle.setFallbackFeed(ethers.ZeroAddress), /Invalid fallback feed|execution reverted|missing revert data/);
    await expectRevert(
      oracle.connect(attacker).setFallbackFeed(await fallbackFeed.getAddress()),
      /Not owner|execution reverted|missing revert data/
    );
    await expectRevert(
      oracle.setFallbackFeed(await mismatchedFeed.getAddress()),
      /Decimals mismatch|execution reverted|missing revert data/
    );

    const replacementFeedAddress = await replacementFeed.getAddress();
    const receipt = await (await oracle.setFallbackFeed(replacementFeedAddress)).wait();
    const event = findEvent(receipt, oracle, 'FallbackFeedUpdated');

    assert(event, 'expected FallbackFeedUpdated event');
    assert.strictEqual(event.args.fallbackFeed.toLowerCase(), replacementFeedAddress.toLowerCase());
    assert.strictEqual((await oracle.fallbackFeed()).toLowerCase(), replacementFeedAddress.toLowerCase());
  });
});
