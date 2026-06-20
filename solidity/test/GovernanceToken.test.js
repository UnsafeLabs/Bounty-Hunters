const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken", function () {
  let token, owner, user1, user2, attacker;

  beforeEach(async function () {
    [owner, user1, user2, attacker] = await ethers.getSigners();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    token = await GovernanceToken.deploy(ethers.utils.parseEther("1000000"));
    await token.deployed();
  });

  describe("Delegate Voting", function () {
    it("should allow users to delegate votes", async function () {
      await token.connect(user1).delegateVote(user2.address);
      expect(await token.delegates(user1.address)).to.equal(user2.address);
    });

    it("should prevent self-delegation", async function () {
      await expect(
        token.connect(user1).delegateVote(user1.address)
      ).to.be.revertedWith("Cannot delegate to self");
    });

    it("should prevent phishing via malicious contract", async function () {
      // Deploy a phishing contract that tries to delegate votes
      const PhishingContract = await ethers.getContractFactory("MockPhishingContract");
      const phishing = await PhishingContract.deploy(token.address);
      await phishing.deployed();

      // The phishing contract should not be able to delegate on behalf of users
      // Users must call delegateVote directly
      await expect(
        phishing.connect(user1).delegateVote(user2.address)
      ).to.be.revertedWith("ERC20: insufficient balance");
    });
  });

  describe("Admin Functions", function () {
    it("should only allow owner to call snapshot", async function () {
      await expect(
        token.connect(user1).snapshot()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should allow owner to call snapshot", async function () {
      await token.connect(owner).snapshot();
    });
  });
});
