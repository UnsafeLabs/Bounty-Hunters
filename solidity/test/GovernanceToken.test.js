const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken", function () {
  let token, owner, alice, bob, carol;

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    token = await GovernanceToken.deploy(ethers.parseEther("1000000"));
  });

  describe("deployment", function () {
    it("should set the admin to the deployer", async function () {
      expect(await token.admin()).to.equal(owner.address);
    });

    it("should mint initial supply to deployer", async function () {
      expect(await token.balanceOf(owner.address)).to.equal(
        ethers.parseEther("1000000")
      );
    });
  });

  describe("delegateVote", function () {
    it("should allow a user to delegate their vote", async function () {
      await token.connect(alice).delegateVote(bob.address);
      expect(await token.delegates(alice.address)).to.equal(bob.address);
    });

    it("should increase delegated power of the delegatee", async function () {
      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.connect(alice).delegateVote(bob.address);
      expect(await token.delegatedPower(bob.address)).to.equal(
        ethers.parseEther("1000")
      );
    });

    it("should prevent delegating to self", async function () {
      await expect(
        token.connect(alice).delegateVote(alice.address)
      ).to.be.revertedWith("Cannot delegate to self");
    });

    it("should update delegation when re-delegating", async function () {
      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.connect(alice).delegateVote(bob.address);
      await token.connect(alice).delegateVote(carol.address);

      expect(await token.delegates(alice.address)).to.equal(carol.address);
      expect(await token.delegatedPower(bob.address)).to.equal(0);
      expect(await token.delegatedPower(carol.address)).to.equal(
        ethers.parseEther("1000")
      );
    });

    it("should not allow a malicious contract to delegate on behalf of tx.origin", async function () {
      const MaliciousDelegate = await ethers.getContractFactory(
        "MaliciousDelegate"
      );
      const malicious = await MaliciousDelegate.deploy(token.target);

      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.connect(alice).delegateVote(bob.address);

      await expect(
        malicious.connect(alice).tryPhishDelegate(carol.address)
      ).to.be.reverted;

      expect(await token.delegates(alice.address)).to.equal(bob.address);
      expect(await token.delegatedPower(carol.address)).to.equal(0);
    });
  });

  describe("revokeDelegate", function () {
    it("should allow a user to revoke their delegation", async function () {
      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.connect(alice).delegateVote(bob.address);
      await token.connect(alice).revokeDelegate();

      expect(await token.delegates(alice.address)).to.equal(
        ethers.ZeroAddress
      );
      expect(await token.delegatedPower(bob.address)).to.equal(0);
    });

    it("should revert if no delegate is set", async function () {
      await expect(
        token.connect(alice).revokeDelegate()
      ).to.be.revertedWith("No delegate");
    });

    it("should not allow a malicious contract to revoke delegation on behalf of tx.origin", async function () {
      const MaliciousDelegate = await ethers.getContractFactory(
        "MaliciousDelegate"
      );
      const malicious = await MaliciousDelegate.deploy(token.target);

      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.connect(alice).delegateVote(bob.address);

      await expect(
        malicious.connect(alice).tryPhishRevoke()
      ).to.be.reverted;

      expect(await token.delegates(alice.address)).to.equal(bob.address);
      expect(await token.delegatedPower(bob.address)).to.equal(
        ethers.parseEther("1000")
      );
    });
  });

  describe("snapshot (admin check)", function () {
    it("should allow admin to call snapshot", async function () {
      await expect(token.connect(owner).snapshot()).to.not.be.reverted;
    });

    it("should revert if non-admin calls snapshot", async function () {
      await expect(
        token.connect(alice).snapshot()
      ).to.be.revertedWith("Not admin");
    });

    it("should not allow a malicious contract to call snapshot via tx.origin", async function () {
      const MaliciousSnapshot = await ethers.getContractFactory(
        "MaliciousSnapshot"
      );
      const malicious = await MaliciousSnapshot.deploy(token.target);

      await expect(
        malicious.connect(owner).tryPhishSnapshot()
      ).to.be.revertedWith("Not admin");
    });
  });

  describe("getVotingPower", function () {
    it("should include own balance and delegated power", async function () {
      await token.transfer(alice.address, ethers.parseEther("1000"));
      await token.transfer(bob.address, ethers.parseEther("500"));
      await token.connect(alice).delegateVote(bob.address);

      expect(await token.getVotingPower(bob.address)).to.equal(
        ethers.parseEther("1500")
      );
    });
  });
});
