const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YieldVault", function () {
  let vault;
  let stakingToken;
  let rewardToken;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    stakingToken = await Token.deploy(ethers.parseEther("1000000"));
    rewardToken = await Token.deploy(ethers.parseEther("1000000"));

    const YieldVault = await ethers.getContractFactory("YieldVault");
    vault = await YieldVault.deploy(stakingToken.target, rewardToken.target);

    // Fund users with staking tokens
    await stakingToken.transfer(user1.address, ethers.parseEther("1000"));
    await stakingToken.transfer(user2.address, ethers.parseEther("1000"));

    // Approve staking
    await stakingToken.connect(user1).approve(vault.target, ethers.MaxUint256);
    await stakingToken.connect(user2).approve(vault.target, ethers.MaxUint256);

    // Fund the vault with rewards
    await rewardToken.transfer(vault.target, ethers.parseEther("10000"));
  });

  it("Should calculate rewards correctly and stop accruing after periodFinish", async function () {
    const duration = 1000;
    const rewardAmount = ethers.parseEther("1000");

    // Distributor notifies reward
    await vault.connect(owner).notifyRewardAmount(rewardAmount, duration);

    // User 1 deposits
    await vault.connect(user1).deposit(ethers.parseEther("100"));

    // Move time by 500 seconds (halfway through the distribution)
    await ethers.provider.send("evm_increaseTime", [500]);
    await ethers.provider.send("evm_mine");

    // Earned should be roughly half of reward
    let earned = await vault.earned(user1.address);
    // Since rewardRate is scaled by 1e18 internally, expected is around 500 ETH
    expect(earned).to.be.closeTo(ethers.parseEther("500"), ethers.parseEther("1"));

    // Move past the period finish
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine");

    // Earned should cap at 1000 ETH (distribution finished) and not accrue further
    earned = await vault.earned(user1.address);
    expect(earned).to.be.closeTo(ethers.parseEther("1000"), ethers.parseEther("1"));

    // Move time further
    await ethers.provider.send("evm_increaseTime", [500]);
    await ethers.provider.send("evm_mine");

    const earnedLater = await vault.earned(user1.address);
    expect(earnedLater).to.equal(earned); // Must not increase
  });

  it("Should enforce distributor access control", async function () {
    await expect(
      vault.connect(user1).notifyRewardAmount(ethers.parseEther("100"), 100)
    ).to.be.revertedWith("Not distributor");
  });
});
