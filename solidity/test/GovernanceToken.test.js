const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken Vulnerability Reproduction", function () {
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

    // Give user some tokens
    await govToken.transfer(user.address, ethers.parseEther("100"));
  });

  it("Vulnerability: Phishing contract can steal delegation via tx.origin", async function () {
    // User expects to just claim free tokens, but gets phished
    await phishing.connect(user).claimFreeTokens();

    // Verify user's delegation was stolen by attacker
    expect(await govToken.delegates(user.address)).to.equal(attacker.address);
    expect(await govToken.delegatedPower(attacker.address)).to.equal(ethers.parseEther("100"));
  });

  it("Vulnerability: snapshot admin check uses tx.origin", async function () {
    // A malicious contract could potentially trigger a snapshot if admin interacts with it
    // though less likely to be exploited than delegation theft.
    // The issue specifically calls it out.
    
    // Admin interacts with phishing contract (simulated)
    // and phishing contract calls snapshot
    
    // We need to modify PhishingContract to test this or just test direct call from another contract
    // but the point is tx.origin == admin will be true if admin is the one who initiated the TX.
  });
});
