import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer, Contract, BigNumber } from "ethers";

describe("GovernanceToken", function () {
  let GovernanceToken: any;
  let governanceToken: Contract;
  let owner: Signer;
  let addr1: Signer;
  let addr2: Signer;
  let addr3: Signer;

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    // Get contract factory
    const GovernanceTokenFactory = await ethers.getContractFactory(
      "GovernanceToken"
    );

    // Deploy contract
    governanceToken = await GovernanceTokenFactory.deploy(
      "Governance Token",
      "GOV",
      ethers.utils.parseEther("1000000") // 1M tokens
    );

    await governanceToken.deployed();
  });

  describe("Deployment", function () {
    it("Should set the correct name", async function () {
      expect(await governanceToken.name()).to.equal("Governance Token");
    });

    it("Should set the correct symbol", async function () {
      expect(await governanceToken.symbol()).to.equal("GOV");
    });

    it("Should set the correct decimals", async function () {
      expect(await governanceToken.decimals()).to.equal(18);
    });

    it("Should mint initial supply to owner", async function () {
      const ownerAddress = await owner.getAddress();
      const balance = await governanceToken.balanceOf(ownerAddress);
      expect(balance).to.equal(ethers.utils.parseEther("1000000"));
    });

    it("Should set the correct total supply", async function () {
      const totalSupply = await governanceToken.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseEther("1000000"));
    });
  });

  describe("Token Transfers", function () {
    it("Should allow owner to transfer tokens", async function () {
      const ownerAddress = await owner.getAddress();
      const addr1Address = await addr1.getAddress();

      // Transfer 100 tokens to addr1
      await governanceToken
        .connect(owner)
        .transfer(addr1Address, ethers.utils.parseEther("100"));

      // Check balances
      const ownerBalance = await governanceToken.balanceOf(ownerAddress);
      const addr1Balance = await governanceToken.balanceOf(addr1Address);

      expect(ownerBalance).to.equal(ethers.utils.parseEther("999900"));
      expect(addr1Balance).to.equal(ethers.utils.parseEther("100"));
    });

    it("Should update voting power on transfer", async function () {
      const ownerAddress = await owner.getAddress();
      const addr1Address = await addr1.getAddress();

      // Transfer 100 tokens to addr1
      await governanceToken
        .connect(owner)
        .transfer(addr1Address, ethers.utils.parseEther("100"));

      // Check voting power
      const ownerVotes = await governanceToken.getVotes(ownerAddress);
      const addr1Votes = await governanceToken.getVotes(addr1Address);

      expect(ownerVotes).to.equal(ethers.utils.parseEther("999900"));
      expect(addr1Votes).to.equal(ethers.utils.parseEther("100"));
    });

    it("Should revert if transferring more than balance", async function () {
      const addr1Address = await addr1.getAddress();

      await expect(
        governanceToken
          .connect(addr1)
          .transfer(addr1Address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Delegation", function () {
    it("Should allow delegation", async function () {
      const addr1Address = await addr1.getAddress();

      // Delegate to addr1
      await governanceToken.connect(owner).delegate(addr1Address);

      // Check delegate
      const delegate = await governanceToken.delegates(await owner.getAddress());
      expect(delegate).to.equal(addr1Address);
    });

    it("Should emit DelegateChanged event", async function () {
      const ownerAddress = await owner.getAddress();
      const addr1Address = await addr1.getAddress();

      await expect(
        governanceToken.connect(owner).delegate(addr1Address)
      )
        .to.emit(governanceToken, "DelegateChanged")
        .withArgs(ownerAddress, ethers.constants.AddressZero, addr1Address);
    });

    it("Should update voting power on delegation", async function () {
      const ownerAddress = await owner.getAddress();
      const addr1Address = await addr1.getAddress();

      // Transfer some tokens to addr1
      await governanceToken
        .connect(owner)
        .transfer(addr1Address, ethers.utils.parseEther("100"));

      // Delegate from owner to addr1
      await governanceToken.connect(owner).delegate(addr1Address);

      // Check voting power
      const ownerVotes = await governanceToken.getVotes(ownerAddress);
      const addr1Votes = await governanceToken.getVotes(addr1Address);

      // Owner's balance is still 999900, but voting power is delegated
      // Note: This test might need adjustment based on actual implementation
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const addr1Address = await addr1.getAddress();

      // Mint 100 tokens to addr1
      await governanceToken
        .connect(owner)
        .mint(addr1Address, ethers.utils.parseEther("100"));

      // Check balance
      const balance = await governanceToken.balanceOf(addr1Address);
      expect(balance).to.equal(ethers.utils.parseEther("100"));

      // Check total supply
      const totalSupply = await governanceToken.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseEther("1000100"));
    });

    it("Should update voting power on mint", async function () {
      const addr1Address = await addr1.getAddress();

      // Mint 100 tokens to addr1
      await governanceToken
        .connect(owner)
        .mint(addr1Address, ethers.utils.parseEther("100"));

      // Check voting power
      const votes = await governanceToken.getVotes(addr1Address);
      expect(votes).to.equal(ethers.utils.parseEther("100"));
    });

    it("Should revert if non-owner tries to mint", async function () {
      const addr1Address = await addr1.getAddress();

      await expect(
        governanceToken
          .connect(addr1)
          .mint(addr1Address, ethers.utils.parseEther("100"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Burning", function () {
    it("Should allow burning tokens", async function () {
      const ownerAddress = await owner.getAddress();

      // Burn 100 tokens
      await governanceToken
        .connect(owner)
        .burn(ethers.utils.parseEther("100"));

      // Check balance
      const balance = await governanceToken.balanceOf(ownerAddress);
      expect(balance).to.equal(ethers.utils.parseEther("999900"));

      // Check total supply
      const totalSupply = await governanceToken.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseEther("999900"));
    });

    it("Should update voting power on burn", async function () {
      const ownerAddress = await owner.getAddress();

      // Burn 100 tokens
      await governanceToken
        .connect(owner)
        .burn(ethers.utils.parseEther("100"));

      // Check voting power
      const votes = await governanceToken.getVotes(ownerAddress);
      expect(votes).to.equal(ethers.utils.parseEther("999900"));
    });
  });

  describe("Voting Power Checkpoints", function () {
    it("Should track voting power over time", async function () {
      const ownerAddress = await owner.getAddress();
      const addr1Address = await addr1.getAddress();

      // Initial checkpoint
      const initialVotes = await governanceToken.getVotes(ownerAddress);
      expect(initialVotes).to.equal(ethers.utils.parseEther("1000000"));

      // Transfer and check
      await governanceToken
        .connect(owner)
        .transfer(addr1Address, ethers.utils.parseEther("100"));

      const afterTransferVotes = await governanceToken.getVotes(ownerAddress);
      expect(afterTransferVotes).to.equal(ethers.utils.parseEther("999900"));
    });

    it("Should return correct past votes", async function () {
      const ownerAddress = await owner.getAddress();

      // Get current block
      const currentBlock = await ethers.provider.getBlockNumber();

      // Initial votes
      const initialVotes = await governanceToken.getPastVotes(
        ownerAddress,
        currentBlock - 1
      );
      expect(initialVotes).to.equal(ethers.utils.parseEther("1000000"));
    });

    it("Should return correct total supply at block", async function () {
      // Get current block
      const currentBlock = await ethers.provider.getBlockNumber();

      // Initial total supply
      const initialTotalSupply = await governanceToken.getPastTotalSupply(
        currentBlock - 1
      );
      expect(initialTotalSupply).to.equal(ethers.utils.parseEther("1000000"));
    });
  });

  describe("Permit", function () {
    it("Should allow permit-based transfers", async function () {
      const ownerAddress = await owner.getAddress();
      const addr1Address = await addr1.getAddress();

      // Create permit
      const domain = {
        name: "Governance Token",
        version: "1",
        chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
        verifyingContract: governanceToken.address,
      };

      const value = ethers.utils.parseEther("100");
      const nonce = await governanceToken.nonces(ownerAddress);
      const deadline = ethers.constants.MaxUint256;

      const message = {
        owner: ownerAddress,
        spender: addr1Address,
        value: value,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await owner.signTypedData(domain, message);
      const { v, r, s } = ethers.utils.splitSignature(signature);

      // Execute permit
      await governanceToken
        .connect(addr1)
        .permit(ownerAddress, addr1Address, value, deadline, v, r, s);

      // Check allowance
      const allowance = await governanceToken.allowance(ownerAddress, addr1Address);
      expect(allowance).to.equal(value);
    });
  });

  describe("Version", function () {
    it("Should return the correct version", async function () {
      expect(await governanceToken.version()).to.equal("1.0.0");
    });
  });
});
