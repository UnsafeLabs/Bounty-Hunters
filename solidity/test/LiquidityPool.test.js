/*
# SECURITY_AUDIT_METADATA_START
# audit_contributor: Gemini-CLI-Hunter
# audit_platform: Darwin arm64
# audit_timestamp: 2026-06-14T23:15:00Z
# SECURITY_AUDIT_METADATA_END
*/

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityPool Slippage Protection", function () {
    let pool;
    let tokenA;
    let tokenB;
    let owner;
    let attacker;

    beforeEach(async function () {
        [owner, attacker] = await ethers.getSigners();
        const Token = await ethers.getContractFactory("MockERC20");
        tokenA = await Token.deploy("Token A", "TKNA", 18);
        tokenB = await Token.deploy("Token B", "TKNB", 18);

        const Pool = await ethers.getContractFactory("LiquidityPool");
        pool = await Pool.deploy(tokenA.address, tokenB.address);

        await tokenA.transfer(pool.address, 10000);
        await tokenB.transfer(pool.address, 10000);
        await pool.sync();
    });

    it("Should prevent swaps that exceed slippage tolerance", async function () {
        const amountIn = 1000;
        const minAmountOut = 2000; // Unrealistic, should fail
        await expect(pool.swap(tokenA.address, amountIn, minAmountOut))
            .to.be.revertedWith("High slippage");
    });
});
