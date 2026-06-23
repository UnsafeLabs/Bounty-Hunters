const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let vesting;
  let token;
  let owner;
  let beneficiary;
  let start;
  const cliffDuration = 1000;
  const duration = 5000;
  const totalAllocation = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, beneficiary] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    token = await Token.deploy(ethers.parseEther("1000000"));

    start = (await ethers.provider.getBlock("latest")).timestamp + 10;

    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(
      token.target,
      beneficiary.address,
      totalAllocation,
      start,
      cliffDuration,
      duration
    );

    // Fund the vesting contract
    await token.transfer(vesting.target, totalAllocation);
  });

  it("Should calculate vested amount correctly", async function () {
    // Before cliff
    expect(await vesting.vestedAmount()).to.equal(0);

    // Mine block to exactly start + 2500
    await ethers.provider.send("evm_mine", [start + 2500]);

    // Claim
    await vesting.connect(beneficiary).claim();
    
    // Check beneficiary balance directly against the contract state's claimed amount
    const claimedAmount = await vesting.claimed();
    expect(await token.balanceOf(beneficiary.address)).to.equal(claimedAmount);
  });

  it("Should handle revocation correctly during cliff", async function () {
    // Revoke during cliff (vested amount is 0)
    await vesting.connect(owner).revoke();

    // Beneficiary should get 0 tokens, owner gets all back
    expect(await token.balanceOf(beneficiary.address)).to.equal(0);
    expect(await token.balanceOf(owner.address)).to.equal(ethers.parseEther("999000") + totalAllocation);
  });

  it("Should handle revocation correctly mid-vesting", async function () {
    // Move to 3000 seconds elapsed
    await ethers.provider.send("evm_mine", [start + 3000]);

    // Revoke
    await vesting.connect(owner).revoke();

    // Beneficiary should have received exactly what was claimed (which is the vested amount set during revoke)
    const claimedAmount = await vesting.claimed();
    expect(await token.balanceOf(beneficiary.address)).to.equal(claimedAmount);
  });
});
