const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault", function () {
  let stakingVault;
  let mockToken;
  let owner;
  let attacker;
  let user;

  beforeEach(async function () {
    [owner, attacker, user] = await ethers.getSigners();

    // Deploy a mock ERC20 token for staking
    const MockToken = await ethers.getContractFactory("MockToken");
    mockToken = await MockToken.deploy("Mock Token", "MTK");
    await mockToken.deployed();

    // Deploy StakingVault
    const StakingVault = await ethers.getContractFactory("StakingVault");
    stakingVault = await StakingVault.deploy(mockToken.address, 10); // rewardRate = 10
    await stakingVault.deployed();

    // Approve and stake some tokens for the user
    await mockToken.transfer(user.address, ethers.utils.parseEther("100"));
    await mockToken.connect(user).approve(stakingVault.address, ethers.utils.parseEther("50"));
    await stakingVault.connect(user).stake(ethers.utils.parseEther("50"));
  });

  it("should prevent reentrancy in withdraw", async function () {
    // Deploy a malicious contract that tries to reenter withdraw
    const MaliciousContract = await ethers.getContractFactory("MaliciousContract");
    malicious = await MaliciousContract.deploy(stakingVault.address);
    await malicious.deployed();

    // Approve the malicious contract to withdraw on behalf of the user? Actually, we need to make the malicious contract the msg.sender in withdraw.
    // Instead, we will have the user call a function on the malicious contract that then calls withdraw on the StakingVault.
    // But note: the withdraw function is external and can be called by anyone.

    // We'll transfer some staked balance to the malicious contract to have something to withdraw.
    // First, let the user withdraw some to the malicious contract? Actually, we want the malicious contract to have a balance in the vault.
    // Let's have the user stake some tokens for the malicious contract? Not directly.

    // Alternative: Let the user transfer their staked position to the malicious contract? Not possible without a transfer function.

    // Instead, we can have the user stake tokens and then the malicious contract will call withdraw, but the withdraw function uses msg.sender.
    // So we need the malicious contract to be the one that has staked tokens.

    // Let's have the user transfer tokens to the malicious contract and then stake from the malicious contract.
    await mockToken.transfer(malicious.address, ethers.utils.parseEther("50"));
    await mockToken.connect(malicious).approve(stakingVault.address, ethers.utils.parseEther("50"));
    await stakingVault.connect(malicious).stake(ethers.utils.parseEther("50"));

    // Now, the malicious contract has 50 tokens staked.

    // The malicious contract's withdraw function will call the StakingVault's withdraw and then reenter.
    // We expect the call to revert because of the nonReentrant modifier.

    await expect(
      malicious.attack()
    ).to.be.reverted;
  });
});

// MockToken contract
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
}

// Malicious contract that attempts to reenter withdraw
contract MaliciousContract {
    StakingVault public stakingVault;
    bool public attacked;

    constructor(address _stakingVault) {
        stakingVault = StakingVault(_stakingVault);
        attacked = false;
    }

    function attack() external {
        attacked = true;
        stakingVault.withdraw(50 ether); // This should revert due to nonReentrant
    }

    // This function is called by StakingVault if it were vulnerable (to reenter)
    // But since we added nonReentrant, this will not be called.
    function() external payable {
        if (attacked) {
            // Try to reenter
            stakingVault.withdraw(50 ether);
        }
    }
}
