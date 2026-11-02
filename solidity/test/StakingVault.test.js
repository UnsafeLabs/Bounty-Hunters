const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StakingVault Reentrancy", function () {
    let stakingVault, stakingToken, rewardToken;
    let owner, attacker, victim;
    let MaliciousContract;

    beforeEach(async function () {
        [owner, attacker, victim] = await ethers.getSigners();
        
        // Deploy tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        stakingToken = await MockERC20.deploy("Stake", "STK", 18);
        rewardToken = await MockERC20.deploy("Reward", "RWD", 18);
        
        // Deploy vault
        const StakingVault = await ethers.getContractFactory("StakingVault");
        stakingVault = await StakingVault.deploy(stakingToken.address, rewardToken.address);
        
        // Mint tokens
        await stakingToken.mint(victim.address, ethers.utils.parseEther("10000"));
        await rewardToken.mint(stakingVault.address, ethers.utils.parseEther("100000"));
        
        // Approve
        await stakingToken.connect(victim).approve(stakingVault.address, ethers.constants.MaxUint256);
        
        // Stake victim
        await stakingVault.connect(victim).stake(ethers.utils.parseEther("1000"));
        
        // Deploy malicious contract
        MaliciousContract = await ethers.getContractFactory("MaliciousStaker");
        malicious = await MaliciousContract.deploy(stakingVault.address, stakingToken.address);
        await stakingToken.mint(malicious.address, ethers.utils.parseEther("1000"));
        await stakingToken.connect(malicious).approve(stakingVault.address, ethers.constants.MaxUint256);
    });

    it("should prevent reentrancy on withdraw", async function () {
        // Malicious contract stakes
        await stakingVault.connect(malicious).stake(ethers.utils.parseEther("1000"));
        
        // Attempt reentrancy attack - should fail
        await expect(
            malicious.connect(attacker).attack()
        ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });

    it("should prevent reentrancy on claimRewards", async function () {
        // Setup rewards
        await stakingVault.setRewardRate(ethers.utils.parseEther("1"));
        
        // Advance time
        await ethers.provider.send("evm_increaseTime", [3600]);
        await ethers.provider.send("evm_mine", []);
        
        // Malicious contract stakes
        await stakingVault.connect(malicious).stake(ethers.utils.parseEther("1000"));
        
        // Attempt reentrancy on claimRewards - should fail
        await expect(
            malicious.connect(attacker).attackClaim()
        ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });
});

// Malicious contract for reentrancy testing
contract MaliciousStaker {
    StakingVault public vault;
    IERC20 public stakingToken;
    bool public attackInProgress = false;
    
    constructor(address _vault, address _token) {
        vault = StakingVault(_vault);
        stakingToken = IERC20(_token);
    }
    
    function attack() external {
        require(!attackInProgress, "Already attacking");
        attackInProgress = true;
        vault.withdraw(1000); // This will re-enter if vulnerable
        attackInProgress = false;
    }
    
    function attackClaim() external {
        require(!attackInProgress, "Already attacking");
        attackInProgress = true;
        vault.claimRewards(); // This will re-enter if vulnerable
        attackInProgress = false;
    }
    
    // Receive ETH fallback for .transfer() calls
    receive() external payable {}
}