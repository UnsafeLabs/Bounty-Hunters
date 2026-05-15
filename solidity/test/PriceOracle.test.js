const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const ORACLE_SOURCE = readFileSync(join(__dirname, "..", "contracts", "PriceOracle.sol"), "utf8");
const MOCK_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggregator {
    uint80 public roundId = 1;
    int256 public answer = 1;
    uint256 public startedAt = 1;
    uint256 public updatedAt = 1;
    uint80 public answeredInRound = 1;
    uint8 public decimals = 8;

    function setRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt,
        uint80 _answeredInRound
    ) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _answeredInRound;
    }

    function latestRoundData() external view returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}
`;

const compiled = compile();

function compile() {
    const input = {
        language: "Solidity",
        sources: {
            "PriceOracle.sol": { content: ORACLE_SOURCE },
            "MockAggregator.sol": { content: MOCK_SOURCE },
        },
        settings: {
            outputSelection: {
                "*": {
                    "*": ["abi", "evm.bytecode.object"],
                },
            },
        },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((error) => error.severity === "error");
    assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
    return output.contracts;
}

function artifact(contractName) {
    const sourceName = contractName === "PriceOracle" ? "PriceOracle.sol" : "MockAggregator.sol";
    const contract = compiled[sourceName][contractName];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

async function deploy(contractName, signer, args = []) {
    const { abi, bytecode } = artifact(contractName);
    const factory = new ethers.ContractFactory(abi, bytecode, signer);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
}

async function setRound(feed, roundId, answer, updatedAt, answeredInRound = roundId) {
    await (await feed.setRoundData(roundId, answer, updatedAt, updatedAt, answeredInRound)).wait();
}

async function fixture() {
    const eip1193Provider = ganache.provider({ logging: { quiet: true } });
    const provider = new ethers.BrowserProvider(eip1193Provider);
    const owner = await provider.getSigner(0);
    const other = await provider.getSigner(1);
    const primary = await deploy("MockAggregator", owner);
    const fallbackFeed = await deploy("MockAggregator", owner);
    const oracle = await deploy("PriceOracle", owner, [await primary.getAddress()]);
    await (await oracle.setFallbackFeed(await fallbackFeed.getAddress())).wait();
    const now = Number((await provider.getBlock("latest")).timestamp);

    return { provider, owner, other, primary, fallbackFeed, oracle, now };
}

test("returns a fresh positive price from a complete primary round", async () => {
    const { primary, fallbackFeed, oracle, now } = await fixture();

    await setRound(primary, 10, 2000n, now - 60, 10);
    await setRound(fallbackFeed, 11, 3000n, now - 60, 11);

    assert.equal(await oracle.getLatestPrice.staticCall(), 2000n);
});

test("falls back and emits the stale primary timestamp when the primary price is stale", async () => {
    const { primary, fallbackFeed, oracle, now } = await fixture();
    const staleUpdatedAt = now - 3601;

    await setRound(primary, 10, 2000n, staleUpdatedAt, 10);
    await setRound(fallbackFeed, 11, 3000n, now - 30, 11);

    assert.equal(await oracle.getLatestPrice.staticCall(), 3000n);

    const receipt = await (await oracle.getLatestPrice()).wait();
    const parsedLogs = receipt.logs.map((log) => {
        try {
            return oracle.interface.parseLog(log);
        } catch {
            return null;
        }
    });
    const staleLog = parsedLogs.find((log) => log && log.name === "StalePrice");

    assert.ok(staleLog, "expected StalePrice event");
    assert.equal(staleLog.args.feed, await primary.getAddress());
    assert.equal(staleLog.args.updatedAt, BigInt(staleUpdatedAt));
});

test("rejects zero and negative primary prices", async () => {
    const { primary, oracle, now } = await fixture();

    await setRound(primary, 10, 0n, now - 60, 10);
    await assert.rejects(oracle.getLatestPrice.staticCall(), /Invalid price/);

    await setRound(primary, 10, -1n, now - 60, 10);
    await assert.rejects(oracle.getLatestPrice.staticCall(), /Invalid price/);
});

test("rejects incomplete primary rounds", async () => {
    const { primary, oracle, now } = await fixture();

    await setRound(primary, 10, 2000n, now - 60, 9);

    await assert.rejects(oracle.getLatestPrice.staticCall(), /Incomplete round/);
});

test("reverts instead of returning a price when both feeds are stale", async () => {
    const { primary, fallbackFeed, oracle, now } = await fixture();

    await setRound(primary, 10, 2000n, now - 3601, 10);
    await setRound(fallbackFeed, 11, 3000n, now - 3601, 11);

    await assert.rejects(oracle.getLatestPrice.staticCall(), /Stale price/);
});

test("lets only the owner configure max staleness", async () => {
    const { primary, fallbackFeed, oracle, other, now } = await fixture();

    await assert.rejects(oracle.connect(other).setMaxStaleness.staticCall(60), /Not owner/);
    await (await oracle.setMaxStaleness(60)).wait();

    await setRound(primary, 10, 2000n, now - 120, 10);
    await setRound(fallbackFeed, 11, 3000n, now - 30, 11);

    assert.equal(await oracle.getLatestPrice.staticCall(), 3000n);
});
