const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken tx.origin hardening (#912)", function () {
  let token, owner, alice, bob, attacker;
  const supply = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, alice, bob, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("GovernanceToken");
    token = await Token.deploy(supply);
    await token.waitForDeployment();

    await token.connect(owner).transfer(alice.address, ethers.parseEther("1000"));
    await token.connect(owner).transfer(bob.address, ethers.parseEther("100"));
  });

  it("exposes Ownable owner (admin tx.origin path removed)", async function () {
    expect(await token.owner()).to.equal(owner.address);
  });

  it("allows legitimate msg.sender delegation and revoke", async function () {
    const amount = ethers.parseEther("1000");
    await token.connect(alice).delegateVote(bob.address);

    expect(await token.delegates(alice.address)).to.equal(bob.address);
    expect(await token.delegatedPower(bob.address)).to.equal(amount);
    // Alice delegated away → her voting power is only received delegatedPower (0)
    expect(await token.getVotingPower(alice.address)).to.equal(0n);
    // Bob keeps own balance + alice's delegated power
    expect(await token.getVotingPower(bob.address)).to.equal(
      ethers.parseEther("100") + amount
    );

    await token.connect(alice).revokeDelegate();
    expect(await token.delegates(alice.address)).to.equal(ethers.ZeroAddress);
    expect(await token.delegatedPower(bob.address)).to.equal(0n);
    expect(await token.getVotingPower(alice.address)).to.equal(amount);
  });

  it("phishing contract cannot delegate victim votes (msg.sender auth)", async function () {
    const Phish = await ethers.getContractFactory("PhishingDelegator");
    const phish = await Phish.deploy(await token.getAddress(), attacker.address);
    await phish.waitForDeployment();

    // Victim interacts with phishing contract. With tx.origin auth this would
    // set delegates[alice]=attacker. With msg.sender, only the phishing
    // contract itself can be the delegator (0 balance → no power moved).
    await phish.connect(alice).bait();
    expect(await phish.baitCalled()).to.equal(true);

    expect(await token.delegates(alice.address)).to.equal(ethers.ZeroAddress);
    expect(await token.delegatedPower(attacker.address)).to.equal(0n);
    expect(await token.getVotingPower(alice.address)).to.equal(ethers.parseEther("1000"));

    // Phishing contract may have set its own (empty) delegate — not the victim
    const phishAddr = await phish.getAddress();
    expect(await token.delegates(phishAddr)).to.equal(attacker.address);
  });

  it("snapshot is onlyOwner; non-owner reverts", async function () {
    await expect(token.connect(alice).snapshot()).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
    await expect(token.connect(owner).snapshot())
      .to.emit(token, "Snapshot")
      .withArgs(owner.address);
  });

  it("governance proposal and voting still work", async function () {
    await token.connect(alice).delegateVote(bob.address);

    await token.connect(bob).createProposal("Raise quorum", 3600);
    const proposalId = 0;

    await token.connect(bob).vote(proposalId, true);
    const proposal = await token.proposals(proposalId);
    expect(proposal.forVotes).to.equal(ethers.parseEther("1100"));

    await expect(token.connect(alice).vote(proposalId, false)).to.be.revertedWith(
      "No voting power"
    );
  });

  it("rejects self-delegation and zero-address delegate", async function () {
    await expect(token.connect(alice).delegateVote(alice.address)).to.be.revertedWith(
      "Cannot delegate to self"
    );
    await expect(token.connect(alice).delegateVote(ethers.ZeroAddress)).to.be.revertedWith(
      "Zero delegate"
    );
  });
});
