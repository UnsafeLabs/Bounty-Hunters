import assert from "node:assert/strict";
import test from "node:test";

const MINIMUM_LIQUIDITY = 1000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const POOL_ADDRESS = "pool";
const ALICE = "alice";
const BOB = "bob";
const DONOR = "donor";

class MockToken {
  constructor() {
    this.balances = new Map();
  }

  mint(account, amount) {
    this.balances.set(account, this.balanceOf(account) + BigInt(amount));
  }

  balanceOf(account) {
    return this.balances.get(account) ?? 0n;
  }

  transfer(from, to, amount) {
    const value = BigInt(amount);
    assert(this.balanceOf(from) >= value, "insufficient token balance");
    this.balances.set(from, this.balanceOf(from) - value);
    this.balances.set(to, this.balanceOf(to) + value);
    return true;
  }
}

class LiquidityPoolModel {
  constructor(tokenA, tokenB) {
    this.tokenA = tokenA;
    this.tokenB = tokenB;
    this.reserveA = 0n;
    this.reserveB = 0n;
    this.lockedMinimumLiquidity = 0n;
    this.lpBalances = new Map();
    this.events = [];
  }

  lpBalanceOf(account) {
    if (account === ZERO_ADDRESS) {
      return this.lockedMinimumLiquidity;
    }

    return this.lpBalances.get(account) ?? 0n;
  }

  totalSupply() {
    let minted = 0n;
    for (const [account, balance] of this.lpBalances.entries()) {
      if (account !== ZERO_ADDRESS) {
        minted += balance;
      }
    }

    return minted + this.lockedMinimumLiquidity;
  }

  mint(account, amount) {
    this.lpBalances.set(account, this.lpBalanceOf(account) + amount);
  }

  burn(account, amount) {
    assert(this.lpBalanceOf(account) >= amount, "Insufficient LP tokens");
    this.lpBalances.set(account, this.lpBalanceOf(account) - amount);
  }

  addLiquidity(provider, amountA, amountB) {
    amountA = BigInt(amountA);
    amountB = BigInt(amountB);
    assert(amountA > 0n && amountB > 0n, "Amounts must be positive");

    this.tokenA.transfer(provider, POOL_ADDRESS, amountA);
    this.tokenB.transfer(provider, POOL_ADDRESS, amountB);

    let lpTokens;
    if (this.totalSupply() === 0n) {
      const grossLiquidity = sqrt(amountA * amountB);
      assert(grossLiquidity > MINIMUM_LIQUIDITY, "Insufficient initial liquidity");
      this.lockedMinimumLiquidity = MINIMUM_LIQUIDITY;
      lpTokens = grossLiquidity - MINIMUM_LIQUIDITY;
      this.events.push(["Transfer", ZERO_ADDRESS, ZERO_ADDRESS, MINIMUM_LIQUIDITY]);
    } else {
      assert(this.reserveA > 0n && this.reserveB > 0n, "Missing reserves");
      const lpFromA = (amountA * this.totalSupply()) / this.reserveA;
      const lpFromB = (amountB * this.totalSupply()) / this.reserveB;
      lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
    }

    assert(lpTokens > 0n, "Insufficient liquidity");
    this.mint(provider, lpTokens);
    this.reserveA += amountA;
    this.reserveB += amountB;
    this.events.push(["LiquidityAdded", provider, amountA, amountB, lpTokens]);
    return lpTokens;
  }

  removeLiquidity(provider, lpTokens) {
    lpTokens = BigInt(lpTokens);
    assert(lpTokens > 0n, "Must burn > 0");
    assert(this.lpBalanceOf(provider) >= lpTokens, "Insufficient LP tokens");

    const supply = this.totalSupply();
    const amountA = (lpTokens * this.reserveA) / supply;
    const amountB = (lpTokens * this.reserveB) / supply;
    assert(amountA > 0n && amountB > 0n, "Insufficient output");

    this.burn(provider, lpTokens);
    this.reserveA -= amountA;
    this.reserveB -= amountB;
    this.tokenA.transfer(POOL_ADDRESS, provider, amountA);
    this.tokenB.transfer(POOL_ADDRESS, provider, amountB);
    this.events.push(["LiquidityRemoved", provider, amountA, amountB, lpTokens]);
    return { amountA, amountB };
  }

  sync() {
    this.reserveA = this.tokenA.balanceOf(POOL_ADDRESS);
    this.reserveB = this.tokenB.balanceOf(POOL_ADDRESS);
    this.events.push(["Sync", this.reserveA, this.reserveB]);
  }
}

function sqrt(value) {
  if (value > 3n) {
    let z = value;
    let x = value / 2n + 1n;
    while (x < z) {
      z = x;
      x = (value / x + x) / 2n;
    }
    return z;
  }

  return value !== 0n ? 1n : 0n;
}

function setup() {
  const tokenA = new MockToken();
  const tokenB = new MockToken();
  for (const account of [ALICE, BOB, DONOR]) {
    tokenA.mint(account, 1_000_000n);
    tokenB.mint(account, 1_000_000n);
  }

  return { pool: new LiquidityPoolModel(tokenA, tokenB), tokenA, tokenB };
}

test("first deposit locks minimum liquidity at the zero address", () => {
  const { pool } = setup();

  const minted = pool.addLiquidity(ALICE, 10_000n, 10_000n);

  assert.equal(minted, 9_000n);
  assert.equal(pool.lpBalanceOf(ALICE), 9_000n);
  assert.equal(pool.lpBalanceOf(ZERO_ADDRESS), MINIMUM_LIQUIDITY);
  assert.equal(pool.totalSupply(), 10_000n);
});

test("first deposit must exceed the minimum-liquidity lock", () => {
  const { pool } = setup();

  assert.throws(
    () => pool.addLiquidity(ALICE, MINIMUM_LIQUIDITY, MINIMUM_LIQUIDITY),
    /Insufficient initial liquidity/,
  );
});

test("subsequent deposits mint from internal reserve proportions", () => {
  const { pool } = setup();

  pool.addLiquidity(ALICE, 10_000n, 10_000n);
  const bobMinted = pool.addLiquidity(BOB, 5_000n, 5_000n);

  assert.equal(bobMinted, 5_000n);
  assert.equal(pool.lpBalanceOf(BOB), 5_000n);
  assert.equal(pool.totalSupply(), 15_000n);
});

test("direct token donations do not affect LP mint pricing before sync", () => {
  const { pool, tokenA, tokenB } = setup();

  pool.addLiquidity(ALICE, 10_000n, 10_000n);
  tokenA.transfer(DONOR, POOL_ADDRESS, 90_000n);
  tokenB.transfer(DONOR, POOL_ADDRESS, 90_000n);
  const bobMinted = pool.addLiquidity(BOB, 10_000n, 10_000n);

  assert.equal(bobMinted, 10_000n);
  assert.equal(pool.reserveA, 20_000n);
  assert.equal(pool.reserveB, 20_000n);
});

test("removeLiquidity uses internal reserves rather than donated balances", () => {
  const { pool, tokenA, tokenB } = setup();

  const aliceMinted = pool.addLiquidity(ALICE, 10_000n, 10_000n);
  tokenA.transfer(DONOR, POOL_ADDRESS, 90_000n);
  tokenB.transfer(DONOR, POOL_ADDRESS, 90_000n);
  const beforeA = tokenA.balanceOf(ALICE);
  const beforeB = tokenB.balanceOf(ALICE);

  const removed = pool.removeLiquidity(ALICE, aliceMinted);

  assert.deepEqual(removed, { amountA: 9_000n, amountB: 9_000n });
  assert.equal(tokenA.balanceOf(ALICE) - beforeA, 9_000n);
  assert.equal(tokenB.balanceOf(ALICE) - beforeB, 9_000n);
  assert.equal(pool.reserveA, 1_000n);
  assert.equal(pool.reserveB, 1_000n);
});

test("sync updates reserves to actual balances and emits a Sync event", () => {
  const { pool, tokenA, tokenB } = setup();

  pool.addLiquidity(ALICE, 10_000n, 10_000n);
  tokenA.transfer(DONOR, POOL_ADDRESS, 2_000n);
  tokenB.transfer(DONOR, POOL_ADDRESS, 3_000n);
  pool.sync();

  assert.equal(pool.reserveA, 12_000n);
  assert.equal(pool.reserveB, 13_000n);
  assert.deepEqual(pool.events.at(-1), ["Sync", 12_000n, 13_000n]);
});
