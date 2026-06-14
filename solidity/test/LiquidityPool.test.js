const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool Price Manipulation", function () {
    let pool;
    let tokenA;
    let tokenB;
    let owner;
    let attacker;

    beforeEach(async function () {
        [owner, attacker] = await ethers.getSigners();
        
        const Token = await ethers.getContractFactory("MockERC20");
        tokenA = await Token.deploy("Token A", "TKA", 18);
        tokenB = await Token.deploy("Token B", "TKB", 18);
        
        const Pool = await ethers.getContractFactory("LiquidityPool");
        pool = await Pool.deploy(tokenA.address, tokenB.address);

        await tokenA.transfer(attacker.address, ethers.utils.parseEther("1000"));
        await tokenB.transfer(attacker.address, ethers.utils.parseEther("1000"));
        
        await tokenA.connect(attacker).approve(pool.address, ethers.constants.MaxUint256);
        await tokenB.connect(attacker).approve(pool.address, ethers.constants.MaxUint256);
    });

    it("Should lock MINIMUM_LIQUIDITY on first deposit to prevent price manipulation", async function () {
        const amount = 2000; // Small initial deposit
        await pool.connect(attacker).addLiquidity(amount, amount);
        
        // 1000 tokens should be permanently locked at address 0
        const zeroAddressBalance = await pool.balanceOf(ethers.constants.AddressZero);
        expect(zeroAddressBalance).to.equal(1000);
        
        // Attacker gets the rest
        const attackerBalance = await pool.balanceOf(attacker.address);
        expect(attackerBalance).to.equal(amount - 1000); // Because sqrt(2000*2000) = 2000
    });

    it("Should prevent donation-based manipulation by using internal reserves", async function () {
        // Legitimate setup
        await pool.connect(owner).addLiquidity(10000, 10000);
        
        // Attacker tries to manipulate price by donating tokens directly to the contract
        await tokenA.connect(attacker).transfer(pool.address, 50000);
        
        // Attacker adds liquidity, hoping to get a disproportionate share
        await pool.connect(attacker).addLiquidity(10000, 10000);
        
        // Since we use internal reserves (10000, 10000), the donation (50000) is ignored
        // The attacker's share is calculated fairly based on reserve, not balanceOf
        const attackerLp = await pool.balanceOf(attacker.address);
        
        // Remove liquidity to ensure math holds up
        await pool.connect(attacker).removeLiquidity(attackerLp);
        
        // Without the fix, the attacker would drain more than they put in
        // With the fix, they only get back their fair share based on reserves
        const finalReserveA = await pool.reserveA();
        expect(finalReserveA).to.equal(10000);
    });

    it("Should allow syncing reserves to recover from donations", async function () {
        await pool.connect(owner).addLiquidity(10000, 10000);
        await tokenA.connect(attacker).transfer(pool.address, 50000);
        
        await pool.sync();
        
        const newReserveA = await pool.reserveA();
        expect(newReserveA).to.equal(60000); // 10000 original + 50000 donation
    });
});
