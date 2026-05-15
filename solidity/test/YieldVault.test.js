const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const VAULT_SOURCE = readFileSync(join(__dirname, "..", "contracts", "YieldVault.sol"), "utf8");
const MOCK_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

const compiled = compile();
const parseEther = ethers.parseEther;

function compile() {
    const input = {
        language: "Solidity",
        sources: {
            "YieldVault.sol": { content: VAULT_SOURCE },
            "MockERC20.sol": { content: MOCK_SOURCE },
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

function artifact(sourceName, contractName) {
    const contract = compiled[sourceName][contractName];
    return {
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
    };
}

async function deploy(contractName, signer, args = []) {
    const sourceName = contractName === "YieldVault" ? "YieldVault.sol" : "MockERC20.sol";
    const { abi, bytecode } = artifact(sourceName, contractName);
    const factory = new ethers.ContractFactory(abi, bytecode, signer);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    return contract;
}

async function mine(provider, seconds) {
    await provider.send("evm_increaseTime", [seconds]);
    await provider.send("evm_mine", []);
}

async function fixture() {
    const eip1193Provider = ganache.provider({ logging: { quiet: true } });
    const provider = new ethers.BrowserProvider(eip1193Provider);
    const distributor = await provider.getSigner(0);
    const alice = await provider.getSigner(1);
    const bob = await provider.getSigner(2);
    const attacker = await provider.getSigner(3);

    const stakingToken = await deploy("MockERC20", distributor);
    const rewardToken = await deploy("MockERC20", distributor);
    const vault = await deploy("YieldVault", distributor, [
        await stakingToken.getAddress(),
        await rewardToken.getAddress(),
    ]);

    await stakingToken.mint(await alice.getAddress(), parseEther("1000"));
    await stakingToken.mint(await bob.getAddress(), parseEther("1000"));
    await rewardToken.mint(await distributor.getAddress(), parseEther("10000"));
    await stakingToken.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await stakingToken.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);

    return { provider, distributor, alice, bob, attacker, stakingToken, rewardToken, vault };
}

test("accrues rewards during the active reward period", async () => {
    const { provider, distributor, alice, rewardToken, vault } = await fixture();

    await vault.connect(alice).deposit(parseEther("100"));
    await rewardToken.connect(distributor).transfer(await vault.getAddress(), parseEther("1000"));
    await vault.connect(distributor).notifyRewardAmount(parseEther("1000"), 1000);
    await mine(provider, 100);

    assert.equal(await vault.earned(await alice.getAddress()), parseEther("100"));
    assert.equal(await vault.rewardPerToken(), parseEther("1"));
});

test("freezes rewardPerToken and earned rewards after the period expires", async () => {
    const { provider, distributor, alice, bob, rewardToken, vault } = await fixture();

    await vault.connect(alice).deposit(parseEther("100"));
    await rewardToken.connect(distributor).transfer(await vault.getAddress(), parseEther("1000"));
    await vault.connect(distributor).notifyRewardAmount(parseEther("1000"), 1000);
    await mine(provider, 1000);

    const rewardPerTokenAtFinish = await vault.rewardPerToken();
    const aliceEarnedAtFinish = await vault.earned(await alice.getAddress());

    await mine(provider, 500);
    assert.equal(await vault.rewardPerToken(), rewardPerTokenAtFinish);
    assert.equal(await vault.earned(await alice.getAddress()), aliceEarnedAtFinish);

    await vault.connect(bob).deposit(parseEther("100"));
    await mine(provider, 500);
    assert.equal(await vault.earned(await bob.getAddress()), 0n);
    assert.equal(await vault.earned(await alice.getAddress()), aliceEarnedAtFinish);
});

test("preserves reward claims and withdrawals", async () => {
    const { provider, distributor, alice, stakingToken, rewardToken, vault } = await fixture();

    await vault.connect(alice).deposit(parseEther("100"));
    await rewardToken.connect(distributor).transfer(await vault.getAddress(), parseEther("1000"));
    await vault.connect(distributor).notifyRewardAmount(parseEther("1000"), 1000);
    await mine(provider, 1000);

    await vault.connect(alice).claimReward();
    await vault.connect(alice).withdraw(parseEther("40"));

    assert.equal(await rewardToken.balanceOf(await alice.getAddress()), parseEther("1000"));
    assert.equal(await stakingToken.balanceOf(await alice.getAddress()), parseEther("940"));
    assert.equal(await vault.balanceOf(await alice.getAddress()), parseEther("60"));
    assert.equal(await vault.rewards(await alice.getAddress()), 0n);
});

test("rejects reward notifications from non-distributors", async () => {
    const { attacker, vault } = await fixture();

    await assert.rejects(
        vault.connect(attacker).notifyRewardAmount.staticCall(parseEther("100"), 1000),
        /Not reward distributor/
    );
});

test("keeps reward rate precision error below 0.01 percent", async () => {
    const { provider, distributor, alice, rewardToken, vault } = await fixture();
    const expectedReward = parseEther("1");

    await vault.connect(alice).deposit(parseEther("1"));
    await rewardToken.connect(distributor).transfer(await vault.getAddress(), expectedReward);
    await vault.connect(distributor).notifyRewardAmount(expectedReward, 3);
    await mine(provider, 3);

    const earned = await vault.earned(await alice.getAddress());
    const errorBps = (expectedReward - earned) * 10000n / expectedReward;
    assert.equal(errorBps, 0n);
    assert.ok(earned >= expectedReward * 9999n / 10000n);
});
