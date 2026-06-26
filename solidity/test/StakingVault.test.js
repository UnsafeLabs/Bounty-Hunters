const{expect}=require("chai");
const{ethers}=require("hardhat");
describe("StakingVault - Reentrancy Fix",function(){
  let vault,mockToken,owner,attacker;
  beforeEach(async()=>{
    [owner,attacker]=await ethers.getSigners();
    const MockToken=await ethers.getContractFactory("MockERC20");
    mockToken=await MockToken.deploy("Mock","MCK",ethers.parseEther("1000000"));
    const StakingVault=await ethers.getContractFactory("StakingVault");
    vault=await StakingVault.deploy(await mockToken.getAddress(),ethers.parseEther("0.001"));
    await owner.sendTransaction({to:await vault.getAddress(),value:ethers.parseEther("10")});
  });
  it("withdraw: state zeroed before external call (CEI)",async()=>{
    await mockToken.transfer(attacker.address,ethers.parseEther("100"));
    await mockToken.connect(attacker).approve(await vault.getAddress(),ethers.parseEther("100"));
    await vault.connect(attacker).stake(ethers.parseEther("100"));
    await vault.connect(attacker).withdraw(ethers.parseEther("100"));
    expect(await vault.balances(attacker.address)).to.equal(0n);
  });
  it("claimRewards: rewards zeroed before external call",async()=>{
    await mockToken.transfer(attacker.address,ethers.parseEther("100"));
    await mockToken.connect(attacker).approve(await vault.getAddress(),ethers.parseEther("100"));
    await vault.connect(attacker).stake(ethers.parseEther("100"));
    await ethers.provider.send("evm_increaseTime",[3600]);
    await ethers.provider.send("evm_mine",[]);
    await vault.connect(attacker).claimRewards();
    expect(await vault.rewards(attacker.address)).to.equal(0n);
  });
  it("nonReentrant blocks recursive withdrawal attack",async()=>{
    const Attacker=await ethers.getContractFactory("ReentrancyAttacker");
    const atk=await Attacker.deploy(await vault.getAddress());
    await mockToken.transfer(await atk.getAddress(),ethers.parseEther("100"));
    await atk.approveAndStake(await mockToken.getAddress(),ethers.parseEther("100"));
    await expect(atk.attack(ethers.parseEther("10"))).to.be.revertedWithCustomError(vault,"ReentrancyGuardReentrantCall");
  });
});
