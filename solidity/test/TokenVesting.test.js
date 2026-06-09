const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  let token;
  let vesting;
  let owner;
  let beneficiary;
  let totalAllocation;
  let start;
  let cliffDuration;
  let vestingDuration;

  beforeEach(async function () {
    [owner, beneficiary] = await ethers.getSigners();

    // Deploy Mock Token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Vesting Token", "VTK");
    await token.waitForDeployment();

    const latestBlock = await ethers.provider.getBlock("latest");
    start = latestBlock.timestamp + 5; // set start slightly in the future to control it
    cliffDuration = 100; // 100 seconds
    vestingDuration = 1000; // 1000 seconds
    totalAllocation = ethers.parseEther("1000"); // 1000 tokens

    const tokenAddress = token.target || token.address;

    // Deploy TokenVesting
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(
      tokenAddress,
      beneficiary.address,
      totalAllocation,
      start,
      cliffDuration,
      vestingDuration
    );
    await vesting.waitForDeployment();

    const vestingAddress = vesting.target || vesting.address;

    // Send tokens to vesting contract
    await token.mint(vestingAddress, ethers.parseEther("1000000000")); // large mint to support all tests
  });

  it("should not overflow for extremely large allocations and elapsed time", async function () {
    const tokenAddress = token.target || token.address;
    const hugeAllocation = ethers.MaxUint256 / 2n; // extremely large allocation that would easily overflow on multiplication
    const hugeVestingDuration = 1000n;

    const latestBlock = await ethers.provider.getBlock("latest");
    const testStart = latestBlock.timestamp + 2;

    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    const hugeVesting = await TokenVesting.deploy(
      tokenAddress,
      beneficiary.address,
      hugeAllocation,
      testStart,
      0, // no cliff
      hugeVestingDuration
    );
    await hugeVesting.waitForDeployment();

    // Fast forward 500 seconds (halfway)
    await ethers.provider.send("evm_increaseTime", [500]);
    await ethers.provider.send("evm_mine");

    const currentBlock = await ethers.provider.getBlock("latest");
    const elapsed = BigInt(currentBlock.timestamp - testStart);

    // Vesting should calculate correctly without overflow revert
    const vested = await hugeVesting.vestedAmount();
    
    // Expected vested using the same linear logic
    const expectedVested = (hugeAllocation / hugeVestingDuration) * elapsed + ((hugeAllocation % hugeVestingDuration) * elapsed) / hugeVestingDuration;
    expect(vested).to.equal(expectedVested);
  });

  it("should handle cliff period revocation correctly", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    
    // Fast forward to inside the cliff (elapsed = 50 from start)
    const targetTime = start + 50;
    const increaseAmount = targetTime - latestBlock.timestamp;
    if (increaseAmount > 0) {
      await ethers.provider.send("evm_increaseTime", [increaseAmount]);
      await ethers.provider.send("evm_mine");
    }

    // Verify block timestamp is indeed before cliff
    const currentBlock = await ethers.provider.getBlock("latest");
    expect(currentBlock.timestamp).to.be.lessThan(start + cliffDuration);

    const initialOwnerBalance = await token.balanceOf(owner.address);
    const initialBeneficiaryBalance = await token.balanceOf(beneficiary.address);

    // Revoke
    await expect(vesting.revoke())
      .to.emit(vesting, "VestingRevoked")
      .withArgs(beneficiary.address, totalAllocation);

    const finalOwnerBalance = await token.balanceOf(owner.address);
    const finalBeneficiaryBalance = await token.balanceOf(beneficiary.address);

    // Owner should receive all tokens, beneficiary gets 0
    expect(finalOwnerBalance - initialOwnerBalance).to.equal(totalAllocation);
    expect(finalBeneficiaryBalance - initialBeneficiaryBalance).to.equal(0n);
  });

  it("should handle post-cliff revocation correctly, transferring already vested tokens to beneficiary and remainder to owner", async function () {
    let latestBlock = await ethers.provider.getBlock("latest");

    // Fast forward to 200 seconds post-start (post-cliff)
    let targetTime = start + 200;
    let increaseAmount = targetTime - latestBlock.timestamp;
    await ethers.provider.send("evm_increaseTime", [increaseAmount]);
    await ethers.provider.send("evm_mine");

    // Beneficiary claims partial amount (at t=200, vested is 200 tokens)
    await vesting.connect(beneficiary).claim();
    const claimedAmount = await vesting.claimed();
    expect(claimedAmount).to.be.closeTo(ethers.parseEther("200"), ethers.parseEther("5"));

    // Fast forward to 500 seconds post-start
    latestBlock = await ethers.provider.getBlock("latest");
    targetTime = start + 500;
    increaseAmount = targetTime - latestBlock.timestamp;
    await ethers.provider.send("evm_increaseTime", [increaseAmount]);
    await ethers.provider.send("evm_mine");

    const initialOwnerBalance = await token.balanceOf(owner.address);
    const initialBeneficiaryBalance = await token.balanceOf(beneficiary.address);

    // Revoke and wait for block
    const tx = await vesting.revoke();
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const elapsed = BigInt(block.timestamp - start);

    // Expected vested amount
    const expectedVested = (totalAllocation / BigInt(vestingDuration)) * elapsed + ((totalAllocation % BigInt(vestingDuration)) * elapsed) / BigInt(vestingDuration);

    const expectedUnvested = totalAllocation - expectedVested;
    const expectedBeneficiaryGet = expectedVested - claimedAmount;

    const finalOwnerBalance = await token.balanceOf(owner.address);
    const finalBeneficiaryBalance = await token.balanceOf(beneficiary.address);

    expect(finalOwnerBalance - initialOwnerBalance).to.equal(expectedUnvested);
    expect(finalBeneficiaryBalance - initialBeneficiaryBalance).to.equal(expectedBeneficiaryGet);
  });

  it("should verify remainder accuracy at full vesting completion", async function () {
    const tokenAddress = token.target || token.address;
    const oddAllocation = 1000000000000000007n; // not divisible by 1000 duration
    const testDuration = 1000n;

    const latestBlock = await ethers.provider.getBlock("latest");
    const testStart = latestBlock.timestamp + 2;

    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    const testVesting = await TokenVesting.deploy(
      tokenAddress,
      beneficiary.address,
      oddAllocation,
      testStart,
      0,
      testDuration
    );
    await testVesting.waitForDeployment();

    // Fast forward 1000 seconds (end of duration)
    await ethers.provider.send("evm_increaseTime", [1002]);
    await ethers.provider.send("evm_mine");

    // Vesting should return exactly the oddAllocation (no truncation loss)
    const vested = await testVesting.vestedAmount();
    expect(vested).to.equal(oddAllocation);
  });
});
