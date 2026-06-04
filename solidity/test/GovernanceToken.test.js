const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken", function () {
  let token;
  let owner;
  let alice;
  let bob;
  let attacker;

  beforeEach(async function () {
    [owner, alice, bob, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("contracts/GovernanceToken.sol:GovernanceToken");
    token = await Token.deploy(ethers.utils.parseEther("1000"));
    await token.deployed();

    // Distribute some tokens
    await token.transfer(alice.address, ethers.utils.parseEther("100"));
    await token.transfer(bob.address, ethers.utils.parseEther("200"));
  });

  describe("Delegation", function () {
    it("should allow delegation and correctly update voting powers", async function () {
      const aliceBalance = await token.balanceOf(alice.address);
      
      // Initially, delegates is zero address
      expect(await token.delegates(alice.address)).to.equal(ethers.constants.AddressZero);
      expect(await token.getVotingPower(alice.address)).to.equal(aliceBalance);
      expect(await token.getVotingPower(bob.address)).to.equal(await token.balanceOf(bob.address));

      // Alice delegates to Bob
      await expect(token.connect(alice).delegateVote(bob.address))
        .to.emit(token, "DelegateChanged")
        .withArgs(alice.address, bob.address);

      expect(await token.delegates(alice.address)).to.equal(bob.address);
      
      // Alice's voting power should now exclude her balance
      expect(await token.getVotingPower(alice.address)).to.equal(0);
      
      // Bob's voting power should now include Alice's balance
      const bobBalance = await token.balanceOf(bob.address);
      expect(await token.getVotingPower(bob.address)).to.equal(bobBalance.add(aliceBalance));
    });

    it("should allow revoking delegation", async function () {
      const aliceBalance = await token.balanceOf(alice.address);
      const bobBalance = await token.balanceOf(bob.address);

      await token.connect(alice).delegateVote(bob.address);
      
      // Revoke delegation
      await expect(token.connect(alice).revokeDelegate())
        .to.emit(token, "DelegateChanged")
        .withArgs(alice.address, ethers.constants.AddressZero);

      expect(await token.delegates(alice.address)).to.equal(ethers.constants.AddressZero);
      expect(await token.getVotingPower(alice.address)).to.equal(aliceBalance);
      expect(await token.getVotingPower(bob.address)).to.equal(bobBalance);
    });

    it("should not allow delegation to self", async function () {
      await expect(token.connect(alice).delegateVote(alice.address))
        .to.be.revertedWith("Cannot delegate to self");
    });
  });

  describe("Snapshot Access Control", function () {
    it("should allow owner/admin to call snapshot", async function () {
      await expect(token.connect(owner).snapshot()).to.not.be.reverted;
    });

    it("should revert if non-owner calls snapshot", async function () {
      await expect(token.connect(alice).snapshot()).to.be.reverted;
    });
  });

  describe("Phishing Attack Mitigation", function () {
    let phishingAttack;

    beforeEach(async function () {
      const PhishingAttackFactory = await ethers.getContractFactory("PhishingAttack");
      phishingAttack = await PhishingAttackFactory.deploy(token.address, attacker.address);
      await phishingAttack.deployed();
    });

    it("should prevent phishing contract from delegating on behalf of victim", async function () {
      const aliceBalance = await token.balanceOf(alice.address);

      // Victim Alice interacts with the PhishingAttack contract, triggering fallback
      // We simulate Alice sending a transaction to the phishing contract
      await alice.sendTransaction({
        to: phishingAttack.address,
        value: 0,
      });

      // Verify that Alice's delegation is NOT set to attacker
      expect(await token.delegates(alice.address)).to.equal(ethers.constants.AddressZero);
      expect(await token.getVotingPower(alice.address)).to.equal(aliceBalance);

      // Verify that the phishing contract itself has its delegation set to attacker
      expect(await token.delegates(phishingAttack.address)).to.equal(attacker.address);
    });
  });
});
