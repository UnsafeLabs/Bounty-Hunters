const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault reentrancy protection", function () {
    let stakingToken;
    let stakingVault;
    let owner;
    let attacker;

    const REWARD_RATE = ethers.parseUnits("1", 14);

    beforeEach(async function () {
        [owner, attacker] = await ethers.getSigners();

        const TokenFactory = await ethers.getContractFactory("ERC20Mock");
        stakingToken = await TokenFactory.deploy("Stake", "STK");
        await stakingToken.waitForDeployment();

        const VaultFactory = await ethers.getContractFactory("StakingVault");
        stakingVault = await VaultFactory.deploy(
            await stakingToken.getAddress(),
            REWARD_RATE
        );
        await stakingVault.waitForDeployment();

        await stakingToken.mint(attacker.address, ethers.parseEther("1000"));
        await stakingToken.mint(owner.address, ethers.parseEther("1000"));

        await owner.sendTransaction({
            to: await stakingVault.getAddress(),
            value: ethers.parseEther("10"),
        });
    });

    it("should prevent reentrancy on withdraw", async function () {
        const StakingReentrancyAttacker = await ethers.getContractFactory(
            "StakingReentrancyAttacker"
        );
        const attackerContract = await StakingReentrancyAttacker.deploy(
            await stakingVault.getAddress()
        );
        await attackerContract.waitForDeployment();

        const stakeAmount = ethers.parseEther("1");
        await stakingToken
            .connect(attacker)
            .transfer(await attackerContract.getAddress(), stakeAmount);
        await attackerContract.doStake(stakeAmount);

        await expect(attackerContract.attackWithdraw()).to.be.revertedWith(
            "ReentrancyGuard: reentrant call"
        );

        expect(
            await stakingVault.getStakedBalance(await attackerContract.getAddress())
        ).to.equal(stakeAmount);
    });

    it("should prevent reentrancy on claimRewards", async function () {
        const StakingReentrancyAttacker = await ethers.getContractFactory(
            "StakingReentrancyAttacker"
        );
        const attackerContract = await StakingReentrancyAttacker.deploy(
            await stakingVault.getAddress()
        );
        await attackerContract.waitForDeployment();

        const stakeAmount = ethers.parseEther("1");
        await stakingToken
            .connect(attacker)
            .transfer(await attackerContract.getAddress(), stakeAmount);
        await attackerContract.doStake(stakeAmount);

        await network.provider.send("evm_increaseTime", [3600]);
        await network.provider.send("evm_mine");

        await expect(attackerContract.attackClaimRewards()).to.be.revertedWith(
            "ReentrancyGuard: reentrant call"
        );

        const pendingReward = await stakingVault.getPendingRewards(
            await attackerContract.getAddress()
        );
        expect(pendingReward).to.be.gt(0);
    });

    it("allows normal withdraw", async function () {
        const stakeAmount = ethers.parseEther("1");
        await stakingToken.connect(attacker).approve(
            await stakingVault.getAddress(),
            stakeAmount
        );
        await stakingVault.connect(attacker).stake(stakeAmount);

        const balanceBefore = await ethers.provider.getBalance(attacker.address);
        const tx = await stakingVault.connect(attacker).withdraw(stakeAmount);
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        expect(
            await stakingVault.getStakedBalance(attacker.address)
        ).to.equal(0);

        const balanceAfter = await ethers.provider.getBalance(attacker.address);
        expect(balanceAfter - balanceBefore + gasUsed).to.equal(stakeAmount);
    });

    it("allows normal claimRewards", async function () {
        const stakeAmount = ethers.parseEther("1");
        await stakingToken.connect(attacker).approve(
            await stakingVault.getAddress(),
            stakeAmount
        );
        await stakingVault.connect(attacker).stake(stakeAmount);

        await network.provider.send("evm_increaseTime", [3600]);
        await network.provider.send("evm_mine");

        const pendingReward = await stakingVault.getPendingRewards(
            attacker.address
        );
        expect(pendingReward).to.be.gt(0);

        await expect(stakingVault.connect(attacker).claimRewards()).to.not.be
            .reverted;

        expect(
            await stakingVault.getPendingRewards(attacker.address)
        ).to.equal(0);
    });
});
