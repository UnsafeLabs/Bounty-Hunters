const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GovernanceToken", function () {
  async function deployToken() {
    const [owner, victim, delegate, attacker] = await ethers.getSigners();
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.deploy(ethers.parseEther("1000"));
    await token.waitForDeployment();

    return { owner, victim, delegate, attacker, token };
  }

  it("delegates and revokes voting power for the direct caller", async function () {
    const { victim, delegate, token } = await deployToken();
    const amount = ethers.parseEther("100");

    await token.transfer(victim.address, amount);
    await token.connect(victim).delegateVote(delegate.address);

    expect(await token.delegates(victim.address)).to.equal(delegate.address);
    expect(await token.delegatedPower(delegate.address)).to.equal(amount);
    expect(await token.getVotingPower(victim.address)).to.equal(0);
    expect(await token.getVotingPower(delegate.address)).to.equal(amount);

    await token.connect(victim).revokeDelegate();

    expect(await token.delegates(victim.address)).to.equal(ethers.ZeroAddress);
    expect(await token.delegatedPower(delegate.address)).to.equal(0);
    expect(await token.getVotingPower(victim.address)).to.equal(amount);
  });

  it("does not let a phishing contract delegate a victim's votes", async function () {
    const { victim, attacker, token } = await deployToken();
    const amount = ethers.parseEther("100");
    const GovernanceTokenPhishing = await ethers.getContractFactory(
      "GovernanceTokenPhishing"
    );
    const phishing = await GovernanceTokenPhishing.connect(attacker).deploy(
      await token.getAddress()
    );
    await phishing.waitForDeployment();

    await token.transfer(victim.address, amount);
    await phishing.connect(victim).phishDelegate(attacker.address);

    expect(await token.delegates(victim.address)).to.equal(ethers.ZeroAddress);
    expect(await token.delegatedPower(attacker.address)).to.equal(0);
    expect(await token.getVotingPower(attacker.address)).to.equal(0);
    expect(await token.delegates(await phishing.getAddress())).to.equal(
      attacker.address
    );
  });

  it("allows a legitimate contract wallet to delegate its own token balance", async function () {
    const { delegate, token } = await deployToken();
    const amount = ethers.parseEther("75");
    const GovernanceTokenDelegationWallet = await ethers.getContractFactory(
      "GovernanceTokenDelegationWallet"
    );
    const wallet = await GovernanceTokenDelegationWallet.deploy(
      await token.getAddress()
    );
    await wallet.waitForDeployment();
    const walletAddress = await wallet.getAddress();

    await token.transfer(walletAddress, amount);
    await wallet.delegateTo(delegate.address);

    expect(await token.delegates(walletAddress)).to.equal(delegate.address);
    expect(await token.delegatedPower(delegate.address)).to.equal(amount);
    expect(await token.getVotingPower(walletAddress)).to.equal(0);
    expect(await token.getVotingPower(delegate.address)).to.equal(amount);
  });

  it("restricts snapshots to the token owner", async function () {
    const { owner, victim, attacker, token } = await deployToken();
    const GovernanceTokenPhishing = await ethers.getContractFactory(
      "GovernanceTokenPhishing"
    );
    const phishing = await GovernanceTokenPhishing.connect(attacker).deploy(
      await token.getAddress()
    );
    await phishing.waitForDeployment();

    await expect(token.connect(owner).snapshot()).not.to.be.reverted;
    await expect(token.connect(victim).snapshot()).to.be.reverted;
    await expect(phishing.connect(owner).phishSnapshot()).to.be.reverted;
  });
});
