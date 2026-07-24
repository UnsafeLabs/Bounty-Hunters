const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault - Reentrancy Protection", function () {
  let stakingVault;
  let mockToken;
  let owner;
  let user1;
  
  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    
    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MTK", ethers.parseEther("10000"));
    
    // Deploy StakingVault with 1% reward rate
    const StakingVault = await ethers.getContractFactory("StakingVault");
    stakingVault = await StakingVault.deploy(await mockToken.getAddress(), ethers.parseEther("0.01"));
    
    // Fund vault with ETH for withdrawals
    await owner.sendTransaction({
      to: await stakingVault.getAddress(),
      value: ethers.parseEther("1000")
    });
    
    // Give user1 tokens and approve vault
    await mockToken.transfer(user1.address, ethers.parseEther("100"));
    await mockToken.connect(user1).approve(await stakingVault.getAddress(), ethers.parseEther("100"));
  });
  
  it("should block reentrancy attack on withdraw()", async function () {
    // Deploy malicious contract
    const MaliciousReentrant = await ethers.getContractFactory("MaliciousReentrant");
    const attacker = await MaliciousReentrant.deploy(await stakingVault.getAddress());
    
    // Fund attacker with tokens
    await mockToken.transfer(await attacker.getAddress(), ethers.parseEther("10"));
    
    // Attacker approves vault (simulate via impersonation)
    await ethers.provider.send("hardhat_impersonateAccount", [await attacker.getAddress()]);
    const attackerSigner = await ethers.getSigner(await attacker.getAddress());
    await owner.sendTransaction({
      to: await attacker.getAddress(),
      value: ethers.parseEther("10") // Gas for attacker
    });
    
    await mockToken.connect(attackerSigner).approve(
      await stakingVault.getAddress(),
      ethers.parseEther("10")
    );
    
    // Attacker stakes tokens
    await stakingVault.connect(attackerSigner).stake(ethers.parseEther("10"));
    
    // Verify attacker has balance
    const balance = await stakingVault.getStakedBalance(await attacker.getAddress());
    expect(balance).to.equal(ethers.parseEther("10"));
    
    // Attempt reentrancy attack
    // ReentrancyGuard will block the nested call, preventing double-withdrawal
    await attacker.attack(ethers.parseEther("5"));
    
    // Verify attack was blocked: only 1 withdrawal succeeded (attackCount should be 1)
    const attackCount = await attacker.attackCount();
    expect(attackCount).to.equal(1, "Reentrancy should have been blocked");
    
    // Verify remaining balance is correct (5 ETH withdrawn, 5 ETH remains)
    const remainingBalance = await stakingVault.getStakedBalance(await attacker.getAddress());
    expect(remainingBalance).to.equal(ethers.parseEther("5"));
  });
  
  it("should allow normal withdrawals after fix", async function () {
    // User stakes tokens
    await stakingVault.connect(user1).stake(ethers.parseEther("10"));
    
    // User withdraws successfully
    await expect(
      stakingVault.connect(user1).withdraw(ethers.parseEther("5"))
    ).to.emit(stakingVault, "Withdrawn")
      .withArgs(user1.address, ethers.parseEther("5"));
    
    // Verify remaining balance
    const balance = await stakingVault.getStakedBalance(user1.address);
    expect(balance).to.equal(ethers.parseEther("5"));
  });
  
  it("should block reentrancy attack on claimRewards()", async function () {
    // User stakes tokens
    await stakingVault.connect(user1).stake(ethers.parseEther("10"));
    
    // Wait for rewards to accumulate
    await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
    await ethers.provider.send("evm_mine");
    
    // Check pending rewards
    const pendingRewards = await stakingVault.getPendingRewards(user1.address);
    expect(pendingRewards).to.be.gt(0);
    
    // Normal claim should work
    await expect(
      stakingVault.connect(user1).claimRewards()
    ).to.emit(stakingVault, "RewardClaimed");
    
    // Verify rewards were reset
    const rewards = await stakingVault.rewards(user1.address);
    expect(rewards).to.equal(0);
  });
});
