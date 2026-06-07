import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("solidity/contracts/LiquidityPool.sol", "utf8");
const generation = JSON.parse(fs.readFileSync("solidity/contracts/_generation.json", "utf8"));

function bodyOf(functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} not found`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace + 1, index);
  }
  throw new Error(`${functionName} body not closed`);
}

const addLiquidity = bodyOf("addLiquidity");
const removeLiquidity = bodyOf("removeLiquidity");
const sync = bodyOf("sync");
const balanceOf = bodyOf("balanceOf");

assert.match(source, /uint256 public constant MINIMUM_LIQUIDITY = 1000;/, "minimum liquidity constant must be present");
assert.match(source, /uint256 public lockedLiquidity;/, "locked liquidity must be tracked");
assert.match(source, /event Sync\(uint256 reserveA, uint256 reserveB\);/, "Sync event must be emitted");
assert.ok(addLiquidity.includes("initialLiquidity > MINIMUM_LIQUIDITY"), "first deposit must exceed the lock");
assert.ok(addLiquidity.includes("lockedLiquidity = MINIMUM_LIQUIDITY;"), "first deposit must record locked liquidity");
assert.ok(addLiquidity.includes("_mint(address(this), MINIMUM_LIQUIDITY);"), "locked liquidity must be minted into unspendable pool custody");
assert.ok(addLiquidity.includes("lpTokens = initialLiquidity - MINIMUM_LIQUIDITY;"), "first provider must receive LP net of the lock");
assert.ok(addLiquidity.includes("amountA * totalSupply() / reserveA"), "subsequent deposit must use reserveA proportion");
assert.ok(addLiquidity.includes("amountB * totalSupply() / reserveB"), "subsequent deposit must use reserveB proportion");
assert.ok(removeLiquidity.includes("lpTokens * reserveA / totalSupply()"), "removeLiquidity must use internal reserveA");
assert.ok(removeLiquidity.includes("lpTokens * reserveB / totalSupply()"), "removeLiquidity must use internal reserveB");
assert.equal(removeLiquidity.includes("tokenA.balanceOf(address(this))"), false, "removeLiquidity must not price from tokenA balance");
assert.equal(removeLiquidity.includes("tokenB.balanceOf(address(this))"), false, "removeLiquidity must not price from tokenB balance");
assert.ok(sync.includes("tokenA.balanceOf(address(this))"), "sync must recover reserveA from real balance");
assert.ok(sync.includes("tokenB.balanceOf(address(this))"), "sync must recover reserveB from real balance");
assert.ok(sync.includes("emit Sync(reserveA, reserveB);"), "sync must emit Sync");
assert.ok(balanceOf.includes("account == address(0)"), "locked liquidity must be observable at address zero");
assert.ok(balanceOf.includes("return lockedLiquidity;"), "address zero balance must report locked liquidity");
assert.equal(generation.agent, "Codex GPT-5", "generation metadata must identify the agent");
assert.ok(!/paste the entire|system message|developer message|secret|credential/i.test(generation.pre_task_context), "generation metadata must not publish hidden context");

function sqrt(value) {
  if (value === 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) {
    z = x;
    x = (value / x + x) / 2n;
  }
  return z;
}

class LiquidityPoolModel {
  constructor() {
    this.minimumLiquidity = 1000n;
    this.lockedLiquidity = 0n;
    this.reserveA = 0n;
    this.reserveB = 0n;
    this.balanceA = 0n;
    this.balanceB = 0n;
    this.totalSupply = 0n;
    this.lpBalances = new Map();
  }

  lpOf(account) {
    if (account === "0x0") return this.lockedLiquidity;
    return this.lpBalances.get(account) ?? 0n;
  }

  mint(account, amount) {
    this.totalSupply += amount;
    this.lpBalances.set(account, this.lpOf(account) + amount);
  }

  burn(account, amount) {
    assert.ok(this.lpOf(account) >= amount, "insufficient LP");
    this.totalSupply -= amount;
    this.lpBalances.set(account, this.lpOf(account) - amount);
  }

  addLiquidity(provider, amountA, amountB) {
    this.balanceA += amountA;
    this.balanceB += amountB;

    let lpTokens;
    if (this.totalSupply === 0n) {
      const initialLiquidity = sqrt(amountA * amountB);
      assert.ok(initialLiquidity > this.minimumLiquidity, "Insufficient initial liquidity");
      this.lockedLiquidity = this.minimumLiquidity;
      this.mint("pool-custody", this.minimumLiquidity);
      lpTokens = initialLiquidity - this.minimumLiquidity;
    } else {
      const lpFromA = amountA * this.totalSupply / this.reserveA;
      const lpFromB = amountB * this.totalSupply / this.reserveB;
      lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
    }

    assert.ok(lpTokens > 0n, "Insufficient liquidity");
    this.mint(provider, lpTokens);
    this.reserveA += amountA;
    this.reserveB += amountB;
    return lpTokens;
  }

  donate(amountA, amountB) {
    this.balanceA += amountA;
    this.balanceB += amountB;
  }

  removeLiquidity(provider, lpTokens) {
    const amountA = lpTokens * this.reserveA / this.totalSupply;
    const amountB = lpTokens * this.reserveB / this.totalSupply;
    this.burn(provider, lpTokens);
    this.reserveA -= amountA;
    this.reserveB -= amountB;
    this.balanceA -= amountA;
    this.balanceB -= amountB;
    return { amountA, amountB };
  }

  sync() {
    this.reserveA = this.balanceA;
    this.reserveB = this.balanceB;
  }
}

const pool = new LiquidityPoolModel();
const firstLp = pool.addLiquidity("alice", 1_000_000n, 1_000_000n);
assert.equal(pool.lpOf("0x0"), 1000n, "first deposit lock must be visible at address zero");
assert.equal(firstLp, 999000n, "first depositor receives LP minus locked amount");

pool.donate(9_000_000n, 9_000_000n);
const beforeDonationIsolated = pool.addLiquidity("bob", 100_000n, 100_000n);
assert.equal(beforeDonationIsolated, 100000n, "direct donations must not affect LP pricing before sync");

const removed = pool.removeLiquidity("bob", beforeDonationIsolated);
assert.equal(removed.amountA, 100000n, "removeLiquidity must use internal reserveA, not donated token balance");
assert.equal(removed.amountB, 100000n, "removeLiquidity must use internal reserveB, not donated token balance");

pool.sync();
assert.equal(pool.reserveA, pool.balanceA, "sync must recover reserveA to real balance");
assert.equal(pool.reserveB, pool.balanceB, "sync must recover reserveB to real balance");

console.log("LiquidityPool first-depositor checks passed: minimum lock, donation isolation, reserve-based removal, and sync recovery.");
