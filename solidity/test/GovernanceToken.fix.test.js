const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken Security Fix Verification", function () {
  let govToken;
  let phishing;
  let admin;
  let user;
  let attacker;

  beforeEach(async function () {
    [admin, user, attacker] = await ethers.getSigners();
    const GovToken = await ethers.getContractFactory("GovernanceToken");
    govToken = await GovToken.deploy(ethers.parseEther("1000"));
    const Phishing = await ethers.getContractFactory("PhishingContract");
    phishing = await Phishing.deploy(await govToken.getAddress(), attacker.address);
    await govToken.transfer(user.address, ethers.parseEther("100"));
  });

  it("Fix: Phishing contract can no longer steal delegation (msg.sender != tx.origin)", async function () {
    await phishing.connect(user).claimFreeTokens();
    expect(await govToken.delegates(user.address)).to.equal(ethers.ZeroAddress);
    expect(await govToken.delegates(await phishing.getAddress())).to.equal(attacker.address);
  });

  it("Fix: snapshot is protected by onlyOwner (Proper msg.sender check)", async function () {
    await expect(govToken.connect(user).snapshot()).to.be.revertedWithCustomError(govToken, "OwnableUnauthorizedAccount");
    await expect(govToken.connect(admin).snapshot()).to.not.be.reverted;
  });

  it("Success: Legitimate delegation works via msg.sender", async function () {
    await govToken.connect(user).delegateVote(attacker.address);
    expect(await govToken.delegates(user.address)).to.equal(attacker.address);
    expect(await govToken.delegatedPower(attacker.address)).to.equal(ethers.parseEther("100"));
  });
});
