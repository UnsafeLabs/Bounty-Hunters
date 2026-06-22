const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken", function () {
  let govToken, phishing, owner, alice, attacker;

  beforeEach(async function () {
    [owner, alice, attacker] = await ethers.getSigners();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    govToken = await GovernanceToken.deploy(ethers.parseEther("1000000"));
    await govToken.waitForDeployment();

    // Give alice some tokens
    await govToken.transfer(alice.address, ethers.parseEther("100000"));
    await govToken.connect(alice).approve(await govToken.getAddress(), ethers.parseEther("100000"));

    // Deploy phishing contract
    const PhishingContract = await ethers.getContractFactory("PhishingContract");
    phishing = await PhishingContract.deploy(await govToken.getAddress());
    await phishing.waitForDeployment();
  });

  describe("Delegation", function () {
    it("allows a user to delegate voting power to another address", async function () {
      await govToken.connect(owner).delegateVote(alice.address);

      expect(await govToken.delegates(owner.address)).to.equal(alice.address);
      expect(await govToken.delegatedPower(alice.address)).to.equal(ethers.parseEther("900000")); // owner has 900k tokens
    });

    it("rejects delegation to zero address", async function () {
      await expect(
        govToken.connect(owner).delegateVote(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid delegate address");
    });

    it("rejects self-delegation", async function () {
      await expect(
        govToken.connect(owner).delegateVote(owner.address)
      ).to.be.revertedWith("Cannot delegate to self");
    });

    it("moves delegation to a new delegate", async function () {
      await govToken.connect(alice).delegateVote(owner.address);
      await govToken.connect(alice).delegateVote(attacker.address);

      expect(await govToken.delegates(alice.address)).to.equal(attacker.address);
      expect(await govToken.delegatedPower(owner.address)).to.equal(0n);
      expect(await govToken.delegatedPower(attacker.address)).to.equal(ethers.parseEther("100000"));
    });

    it("allows revoking delegation", async function () {
      await govToken.connect(owner).delegateVote(alice.address);
      await govToken.connect(owner).revokeDelegate();

      expect(await govToken.delegates(owner.address)).to.equal(ethers.ZeroAddress);
      expect(await govToken.delegatedPower(alice.address)).to.equal(0n);
    });

    it("rejects revoking when no delegate exists", async function () {
      await expect(
        govToken.connect(owner).revokeDelegate()
      ).to.be.revertedWith("No delegate");
    });
  });

  describe("Anti-phishing", function () {
    it("prevents phishing contract from stealing user votes (msg.sender vs tx.origin)", async function () {
      // Before fix with tx.origin: phishing contract calls delegateVote,
      // and tx.origin = owner (EOA) → owner's votes get delegated to attacker
      // After fix with msg.sender: phishing contract delegates its own
      // (zero balance) votes, not the user's

      // Setup: owner delegates to alice normally
      await govToken.connect(owner).delegateVote(alice.address);
      expect(await govToken.delegates(owner.address)).to.equal(alice.address);

      // Owner interacts with phishing contract, which calls delegateVote
      // With msg.sender fix, phishing contract can only use its own tokens
      await phishing.connect(owner).phishDelegate(attacker.address);

      // Owner's delegation should remain unchanged
      expect(await govToken.delegates(owner.address)).to.equal(alice.address);
      // Phishing contract has no tokens, so attacker got 0 delegated power
      expect(await govToken.delegatedPower(attacker.address)).to.equal(0n);
    });

    it("phishing contract can only delegate its own tokens, not the victim's", async function () {
      // Give phishing contract some tokens
      await govToken.transfer(await phishing.getAddress(), ethers.parseEther("50000"));

      // Owner delegates to alice
      await govToken.connect(owner).delegateVote(alice.address);
      const ownerPower = await govToken.delegatedPower(alice.address);

      // Phishing contract tries to phish — but can only delegate ITS OWN tokens (50k)
      await phishing.connect(owner).phishDelegate(attacker.address);

      // Owner's delegation untouched
      expect(await govToken.delegates(owner.address)).to.equal(alice.address);
      expect(await govToken.delegatedPower(alice.address)).to.equal(ownerPower);

      // Phishing contract delegated its own 50k to attacker
      expect(await govToken.delegatedPower(attacker.address)).to.equal(ethers.parseEther("50000"));
      expect(await govToken.delegates(await phishing.getAddress())).to.equal(attacker.address);
    });
  });

  describe("Admin (Ownable)", function () {
    it("allows owner to call snapshot", async function () {
      await expect(govToken.connect(owner).snapshot()).to.not.be.reverted;
    });

    it("rejects non-owner snapshot", async function () {
      await expect(
        govToken.connect(alice).snapshot()
      ).to.be.revertedWithCustomError(govToken, "OwnableUnauthorizedAccount");
    });
  });

  describe("Voting power", function () {
    it("returns token balance for undelegated accounts", async function () {
      const power = await govToken.getVotingPower(owner.address);
      expect(power).to.equal(ethers.parseEther("900000")); // owner has 900k
    });

    it("includes delegated power", async function () {
      await govToken.connect(alice).delegateVote(owner.address);
      const power = await govToken.getVotingPower(owner.address);
      // owner has 900k balance + 100k delegated from alice
      expect(power).to.equal(ethers.parseEther("1000000"));
    });
  });

  describe("Proposals and voting", function () {
    beforeEach(async function () {
      await govToken.createProposal("Test proposal", 3600); // 1 hour
    });

    it("allows voting for a proposal", async function () {
      await govToken.connect(alice).vote(0, true);
      const proposal = await govToken.proposals(0);
      expect(proposal.forVotes).to.equal(ethers.parseEther("100000"));
    });

    it("prevents double voting", async function () {
      await govToken.connect(alice).vote(0, true);
      await expect(
        govToken.connect(alice).vote(0, false)
      ).to.be.revertedWith("Already voted");
    });

    it("prevents voting after deadline", async function () {
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await expect(
        govToken.connect(alice).vote(0, true)
      ).to.be.revertedWith("Voting ended");
    });

    it("prevents voting with no voting power", async function () {
      const [, , , zeroUser] = await ethers.getSigners();
      await expect(
        govToken.connect(zeroUser).vote(0, true)
      ).to.be.revertedWith("No voting power");
    });

    it("accounts for delegated power in votes", async function () {
      await govToken.connect(alice).delegateVote(owner.address);
      await govToken.connect(owner).vote(0, true);
      const proposal = await govToken.proposals(0);
      // owner: 900k balance + 100k delegated from alice = 1M voting power
      expect(proposal.forVotes).to.equal(ethers.parseEther("1000000"));
    });
  });
});
