const assert = require("node:assert/strict");
const { beforeEach, describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const poolPath = path.join(__dirname, "..", "contracts", "LiquidityPool.sol");
const zeroAddress = "0x0000000000000000000000000000000000000000";

const ierc20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
`;

const mockSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
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
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
`;

function compileContracts() {
    const input = {
        language: "Solidity",
        sources: {
            "solidity/contracts/LiquidityPool.sol": {
                content: fs.readFileSync(poolPath, "utf8"),
            },
            "@openzeppelin/contracts/token/ERC20/IERC20.sol": {
                content: ierc20Source,
            },
            "solidity/test/PoolMocks.sol": {
                content: mockSource,
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

function artifact(contracts, source, name) {
    const contract = contracts[source][name];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

async function deploy(factory, ...args) {
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
}

async function send(transaction) {
    const response = await transaction;
    return response.wait();
}

describe("LiquidityPool", () => {
    let provider;
    let owner;
    let secondProvider;
    let contracts;
    let tokenA;
    let tokenB;
    let pool;

    beforeEach(async () => {
        provider = new ethers.BrowserProvider(
            ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 3 } }),
        );
        owner = await provider.getSigner(0);
        secondProvider = await provider.getSigner(1);
        contracts = compileContracts();

        const tokenFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/test/PoolMocks.sol", "MockERC20").abi,
            artifact(contracts, "solidity/test/PoolMocks.sol", "MockERC20").bytecode,
            owner,
        );
        tokenA = await deploy(tokenFactory, "Token A", "TKNA");
        tokenB = await deploy(tokenFactory, "Token B", "TKNB");

        const poolFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/contracts/LiquidityPool.sol", "LiquidityPool").abi,
            artifact(contracts, "solidity/contracts/LiquidityPool.sol", "LiquidityPool").bytecode,
            owner,
        );
        pool = await deploy(poolFactory, await tokenA.getAddress(), await tokenB.getAddress());

        for (const signer of [owner, secondProvider]) {
            const address = await signer.getAddress();
            await send(tokenA.mint(address, 20_000_000n));
            await send(tokenB.mint(address, 20_000_000n));
            await send(tokenA.connect(signer).approve(await pool.getAddress(), 20_000_000n));
            await send(tokenB.connect(signer).approve(await pool.getAddress(), 20_000_000n));
        }
    });

    it("locks minimum liquidity at address zero on the first deposit", async () => {
        const ownerAddress = await owner.getAddress();

        await send(pool.addLiquidity(1_000_000n, 1_000_000n));

        assert.equal(await pool.totalSupply(), 1_000_000n);
        assert.equal(await pool.balanceOf(zeroAddress), 1_000n);
        assert.equal(await pool.balanceOf(ownerAddress), 999_000n);
        assert.equal(await pool.reserveA(), 1_000_000n);
        assert.equal(await pool.reserveB(), 1_000_000n);
    });

    it("rejects a tiny first deposit that cannot exceed the minimum liquidity lock", async () => {
        await assert.rejects(send(pool.addLiquidity(1_000n, 1_000n)));
        assert.equal(await pool.totalSupply(), 0n);
        assert.equal(await pool.balanceOf(zeroAddress), 0n);
    });

    it("prices subsequent deposits from internal reserves despite direct donations", async () => {
        const secondAddress = await secondProvider.getAddress();
        await send(pool.addLiquidity(1_000_000n, 1_000_000n));

        await send(tokenA.transfer(await pool.getAddress(), 9_000_000n));
        await send(tokenB.transfer(await pool.getAddress(), 9_000_000n));
        await send(pool.connect(secondProvider).addLiquidity(100_000n, 100_000n));

        assert.equal(await pool.balanceOf(secondAddress), 100_000n);
        assert.equal(await pool.reserveA(), 1_100_000n);
        assert.equal(await pool.reserveB(), 1_100_000n);
    });

    it("removes liquidity using internal reserves instead of manipulable token balances", async () => {
        const ownerAddress = await owner.getAddress();
        await send(pool.addLiquidity(1_000_000n, 1_000_000n));
        await send(tokenA.transfer(await pool.getAddress(), 9_000_000n));

        const beforeA = await tokenA.balanceOf(ownerAddress);
        const beforeB = await tokenB.balanceOf(ownerAddress);
        await send(pool.removeLiquidity(100_000n));

        assert.equal((await tokenA.balanceOf(ownerAddress)) - beforeA, 100_000n);
        assert.equal((await tokenB.balanceOf(ownerAddress)) - beforeB, 100_000n);
        assert.equal(await pool.reserveA(), 900_000n);
        assert.equal(await pool.reserveB(), 900_000n);
    });

    it("syncs internal reserves to actual balances after donation recovery", async () => {
        await send(pool.addLiquidity(1_000_000n, 1_000_000n));
        await send(tokenA.transfer(await pool.getAddress(), 9_000_000n));
        await send(tokenB.transfer(await pool.getAddress(), 4_000_000n));

        const receipt = await send(pool.sync());
        const syncLog = receipt.logs
            .map((log) => pool.interface.parseLog(log))
            .find((log) => log?.name === "Sync");

        assert.equal(syncLog.name, "Sync");
        assert.equal(syncLog.args.reserveA, 10_000_000n);
        assert.equal(syncLog.args.reserveB, 5_000_000n);
        assert.equal(await pool.reserveA(), 10_000_000n);
        assert.equal(await pool.reserveB(), 5_000_000n);
    });
});
