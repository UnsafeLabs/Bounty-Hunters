const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken — tx.origin Phishing Protection", function () {
  let GovernanceToken, governanceToken, owner, user, attacker, proxy;

  before(async function () {
    [owner, user, attacker, proxy] = await ethers.getSigners();
  });

  beforeEach(async function () {
    const GovernanceTokenFactory = await ethers.getContractFactory("GovernanceToken");
    governanceToken = await GovernanceTokenFactory.deploy(ethers.parseEther("1000"));
    await governanceToken.waitForDeployment();

    // Transfer some tokens to user
    await governanceToken.transfer(user.address, ethers.parseEther("100"));
  });

  describe("tx.origin phishing protection", function () {
    it("should use msg.sender instead of tx.origin for delegateVote", async function () {
      // Deploy phishing proxy contract that would exploit tx.origin
      const PhishingProxy = await ethers.getContractFactory("PhishingProxy");
      const phishingContract = await PhishingProxy.deploy(await governanceToken.getAddress());
      await phishingContract.waitForDeployment();

      // Victim approves phishing contract (simulating phishing tx)
      await governanceToken.connect(user).approve(await phishingContract.getAddress(), ethers.parseEther("100"));

      // Phishing contract calls delegateVote on behalf of victim
      // With tx.origin, this would delegate the victim's votes to attacker
      // With msg.sender, it delegates the contract's own votes (which are 0)
      await phishingContract.connect(user).phishDelegate(attacker.address);

      // Verify: user's delegate should NOT have been changed
      const userDelegate = await governanceToken.delegates(user.address);
      expect(userDelegate).to.equal(ethers.ZeroAddress);

      // Verify: phishing contract's own delegate IS set (it delegated itself, not the victim)
      const proxyDelegate = await governanceToken.delegates(await phishingContract.getAddress());
      expect(proxyDelegate).to.equal(attacker.address);
    });

    it("should use msg.sender in revokeDelegate", async function () {
      // User delegates normally
      await governanceToken.connect(user).delegateVote(owner.address);
      expect(await governanceToken.delegates(user.address)).to.equal(owner.address);

      // Phishing contract tries to trick user into revoking their delegation
      const PhishingProxy = await ethers.getContractFactory("PhishingProxy");
      const phishingContract = await PhishingProxy.deploy(await governanceToken.getAddress());
      await phishingContract.waitForDeployment();

      await governanceToken.connect(user).approve(await phishingContract.getAddress(), ethers.parseEther("100"));
      await phishingContract.connect(user).phishRevoke();

      // User's delegate should still be intact
      expect(await governanceToken.delegates(user.address)).to.equal(owner.address);
    });

    it("should use msg.sender in snapshot admin check", async function () {
      // Only admin (owner) can call snapshot
      expect(await governanceToken.admin()).to.equal(owner.address);

      // Non-admin through phishing contract should fail
      const PhishingProxy = await ethers.getContractFactory("PhishingProxy");
      const phishingContract = await PhishingProxy.deploy(await governanceToken.getAddress());
      await phishingContract.waitForDeployment();

      await expect(phishingContract.connect(user).phishSnapshot()).to.be.revertedWith("Not admin");

      // Admin directly can still call
      await governanceToken.connect(owner).snapshot();
    });

    it("should allow direct delegation from user", async function () {
      await governanceToken.connect(user).delegateVote(owner.address);
      expect(await governanceToken.delegates(user.address)).to.equal(owner.address);
      expect(await governanceToken.getVotingPower(owner.address))
        .to.equal(ethers.parseEther("100")); // owner gets user's voting power
    });
  });
});
