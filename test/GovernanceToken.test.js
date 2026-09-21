const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken - tx.origin phishing mitigation", function () {
  let token;
  let owner, alice, bob, attacker;

  beforeEach(async function () {
    [owner, alice, bob, attacker] = await ethers.getSigners();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    token = await GovernanceToken.deploy("GovToken", "GOV");
    await token.deployed();

    // Mint tokens to Alice for testing
    await token.connect(owner).mint(alice.address, ethers.utils.parseUnits("100", 18));
  });

  it("should allow legitimate delegation", async function () {
    // Alice delegates to Bob
    await token.connect(alice).delegateVote(bob.address);

    const aliceDelegate = await token.delegatee(alice.address);
    expect(aliceDelegate).to.equal(bob.address);

    const bobPower = await token.getVotingPower(bob.address);
    const expected = ethers.utils.parseUnits("100", 18);
    expect(bobPower).to.equal(expected);
  });

  it("phishing contract cannot delegate on behalf of user via tx.origin", async function () {
    // Deploy a malicious contract that tries to delegate on behalf of the caller
    const Phishing = await ethers.getContractFactory("PhishingContract");
    const phishing = await Phishing.deploy(token.address);
    await phishing.deployed();

    // Alice (victim) calls the phishing contract, attempting to delegate to Bob
    await expect(
      phishing.connect(alice).attack(bob.address)
    ).to.not.be.reverted; // transaction succeeds but should have no effect on Alice's delegation

    // Alice's delegatee should still be zero address
    const aliceDelegate = await token.delegatee(alice.address);
    expect(aliceDelegate).to.equal(ethers.constants.AddressZero);

    // Bob's voting power should remain zero (no delegated votes)
    const bobPower = await token.getVotingPower(bob.address);
    expect(bobPower).to.equal(0);
  });
});
