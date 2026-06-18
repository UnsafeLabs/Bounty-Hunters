import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("YieldVault Phantom Reward Accrual", function () {
  let stakingToken;
  let rewardToken;
  let yieldVault;
  let owner;
  let user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy GovernanceToken as stakingToken
    const TokenFactory = await ethers.getContractFactory("GovernanceToken");
    stakingToken = await TokenFactory.deploy(ethers.parseEther("1000000"));
    await stakingToken.waitForDeployment();

    // Deploy GovernanceToken as rewardToken
    rewardToken = await TokenFactory.deploy(ethers.parseEther("1000000"));
    await rewardToken.waitForDeployment();

    // Deploy YieldVault
    const YieldVaultFactory = await ethers.getContractFactory("YieldVault");
    yieldVault = await YieldVaultFactory.deploy(
      await stakingToken.getAddress(),
      await rewardToken.getAddress()
    );
    await yieldVault.waitForDeployment();

    // Transfer some reward tokens to YieldVault
    await rewardToken.transfer(await yieldVault.getAddress(), ethers.parseEther("10000"));

    // Transfer staking tokens to user and approve YieldVault
    await stakingToken.transfer(user.address, ethers.parseEther("1000"));
    await stakingToken.connect(user).approve(await yieldVault.getAddress(), ethers.parseEther("1000"));
  });

  it("should stop reward accrual after period finish", async function () {
    // Notify reward amount: 1000 tokens for 100 seconds (rate = 10 token/sec)
    const rewardAmount = ethers.parseEther("1000");
    const duration = 100; // seconds
    await yieldVault.notifyRewardAmount(rewardAmount, duration);

    // User deposits 100 staking tokens
    const depositAmount = ethers.parseEther("100");
    await yieldVault.connect(user).deposit(depositAmount);

    // Fast forward block time by 50 seconds
    await ethers.provider.send("evm_increaseTime", [50]);
    await ethers.provider.send("evm_mine");

    const earnedAt50 = await yieldVault.earned(user.address);
    // User should have earned approximately 50 seconds * rate = 50 * 10 = 500 reward tokens
    expect(earnedAt50).to.be.closeTo(ethers.parseEther("500"), ethers.parseEther("10"));

    // Fast forward block time past the finish period (total 150 seconds from start)
    await ethers.provider.send("evm_increaseTime", [100]);
    await ethers.provider.send("evm_mine");

    const earnedAt150 = await yieldVault.earned(user.address);
    const earnedAtFinishExpected = ethers.parseEther("1000");

    console.log("Earned at 150s:", ethers.formatEther(earnedAt150));
    console.log("Expected at finish:", ethers.formatEther(earnedAtFinishExpected));

    // If bug is fixed, earnedAt150 should be equal to the max possible reward of 1000,
    // NOT continue to grow (e.g. 1500)
    expect(earnedAt150).to.be.closeTo(earnedAtFinishExpected, ethers.parseEther("10"));
  });
});
