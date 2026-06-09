const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let stakingToken;
  let rewardToken;
  let vault;
  let owner;
  let distributor;
  let user;

  beforeEach(async function () {
    [owner, distributor, user] = await ethers.getSigners();

    // Deploy Mock Tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    stakingToken = await MockERC20.deploy("Staking Token", "STK");
    await stakingToken.waitForDeployment();

    rewardToken = await MockERC20.deploy("Reward Token", "RWD");
    await rewardToken.waitForDeployment();

    // Deploy YieldVault (distributor will be owner)
    const YieldVault = await ethers.getContractFactory("YieldVault");
    const stakingTokenAddress = stakingToken.target || stakingToken.address;
    const rewardTokenAddress = rewardToken.target || rewardToken.address;
    vault = await YieldVault.deploy(stakingTokenAddress, rewardTokenAddress);
    await vault.waitForDeployment();

    const vaultAddress = vault.target || vault.address;

    // Transfer rewards to vault
    await rewardToken.mint(vaultAddress, ethers.parseEther("100000"));

    // Set up user tokens
    await stakingToken.mint(user.address, ethers.parseEther("1000"));
    await stakingToken.connect(user).approve(vaultAddress, ethers.MaxUint256);
  });

  it("should only allow distributor to call notifyRewardAmount", async function () {
    const reward = ethers.parseEther("100");
    const duration = 100;

    // Caller is owner (who is distributor in constructor)
    await expect(vault.notifyRewardAmount(reward, duration)).to.not.be.reverted;

    // Connect user and try to notify
    await expect(
      vault.connect(user).notifyRewardAmount(reward, duration)
    ).to.be.revertedWith("Only reward distributor");
  });

  it("should accrue rewards correctly during the period and freeze them after periodFinish", async function () {
    const reward = ethers.parseEther("100"); // 100 RWD
    const duration = 100; // 100 seconds

    // User deposits 10 tokens BEFORE notifying reward
    const depositAmount = ethers.parseEther("10");
    await vault.connect(user).deposit(depositAmount);

    // Notify reward (starts at current time)
    await vault.notifyRewardAmount(reward, duration);

    // Fast-forward 50 seconds
    await ethers.provider.send("evm_increaseTime", [50]);
    await ethers.provider.send("evm_mine");

    // Earned should be exactly 50 RWD
    let earned = await vault.earned(user.address);
    expect(earned).to.equal(ethers.parseEther("50"));

    // Fast-forward another 100 seconds (past periodFinish)
    await ethers.provider.send("evm_increaseTime", [100]);
    await ethers.provider.send("evm_mine");

    // Earned should be exactly 100 RWD (period finish has passed, rewards capped)
    earned = await vault.earned(user.address);
    expect(earned).to.equal(ethers.parseEther("100"));

    // Fast-forward another 100 seconds (long after periodFinish)
    await ethers.provider.send("evm_increaseTime", [100]);
    await ethers.provider.send("evm_mine");

    // Earned should STILL be exactly 100 RWD (frozen, no phantom rewards accrue)
    const earnedAfter = await vault.earned(user.address);
    expect(earnedAfter).to.equal(earned);
  });

  it("should verify precision and avoid loss on very small reward rates", async function () {
    // User deposits 10 tokens BEFORE notifying
    await vault.connect(user).deposit(ethers.parseEther("10"));

    // 3 wei of reward over 3 seconds (1 wei per second)
    const reward = 3n;
    const duration = 3;

    await vault.notifyRewardAmount(reward, duration);

    // Fast-forward 3 seconds (end of period)
    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine");

    // User earned should be exactly 3 wei
    const earned = await vault.earned(user.address);
    expect(earned).to.equal(3n);

    // Claim reward
    const initialBalance = await rewardToken.balanceOf(user.address);
    await vault.connect(user).claimReward();
    const finalBalance = await rewardToken.balanceOf(user.address);

    expect(finalBalance - initialBalance).to.equal(3n);
  });

  it("should function correctly for normal deposit, withdraw, and claim flows", async function () {
    // User deposits 50 tokens
    await vault.connect(user).deposit(ethers.parseEther("50"));
    expect(await vault.balanceOf(user.address)).to.equal(ethers.parseEther("50"));

    // Notify reward: 10 RWD over 10 seconds (1 RWD/sec)
    const reward = ethers.parseEther("10");
    const duration = 10;
    await vault.notifyRewardAmount(reward, duration);

    // Wait 5 seconds
    await ethers.provider.send("evm_increaseTime", [5]);
    await ethers.provider.send("evm_mine");

    // Check earned at t=5 (should be 5 RWD)
    let earned = await vault.earned(user.address);
    expect(earned).to.be.closeTo(ethers.parseEther("5"), 100);

    // Withdraw 20 (this transaction takes 1 second, so it will be t=6)
    await vault.connect(user).withdraw(ethers.parseEther("20"));
    expect(await vault.balanceOf(user.address)).to.equal(ethers.parseEther("30"));

    // Check earned at t=6 (should be 6 RWD)
    earned = await vault.earned(user.address);
    expect(earned).to.be.closeTo(ethers.parseEther("6"), 100);

    // Claim (this transaction takes 1 second, so it will be t=7)
    const initialUserReward = await rewardToken.balanceOf(user.address);
    await vault.connect(user).claimReward();
    const finalUserReward = await rewardToken.balanceOf(user.address);

    // Should receive 7 RWD
    expect(finalUserReward - initialUserReward).to.be.closeTo(ethers.parseEther("7"), 100);
  });
});
