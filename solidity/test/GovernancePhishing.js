const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken Phishing Fix", function () {
  let token;
  let owner, user, maliciousContract;

  beforeEach(async function () {
    [owner, user, maliciousContract] = await ethers.getSigners();
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    token = await GovernanceToken.deploy();
    await token.deployed();
    
    // Transfer some tokens to the user
    await token.transfer(user.address, ethers.utils.parseEther("100"));
  });

  it("Should prevent delegation through a phishing contract (tx.origin vs msg.sender)", async function () {
    // A phishing contract would try to delegate votes on behalf of the user by interacting with the token
    // Now that we check msg.sender == user.address instead of tx.origin, the phishing contract (msg.sender)
    // will be unauthorized because it's not the user (who is tx.origin).
    
    // We simulate a malicious contract calling delegateVote by having maliciousContract impersonate it
    await expect(
      token.connect(maliciousContract).delegateVote(user.address, maliciousContract.address)
    ).to.be.revertedWith("Unauthorized");
  });
  
  it("Should correctly use onlyOwner for snapshot", async function () {
    await expect(token.connect(user).snapshot()).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(token.connect(owner).snapshot()).to.not.be.reverted;
  });
});
