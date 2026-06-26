import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/LiquidityPool.sol", import.meta.url), "utf8");
const MINIMUM_LIQUIDITY = 1000n;

function sqrt(value) {
  if (value < 2n) return value;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) {
    z = x;
    x = (value / x + x) / 2n;
  }
  return z;
}

function firstDeposit(amountA, amountB) {
  const initialLiquidity = sqrt(amountA * amountB);
  if (initialLiquidity <= MINIMUM_LIQUIDITY) throw new Error("Insufficient initial liquidity");
  return {
    lockedLiquidity: MINIMUM_LIQUIDITY,
    mintedToProvider: initialLiquidity - MINIMUM_LIQUIDITY,
    totalSupply: initialLiquidity,
    reserveA: amountA,
    reserveB: amountB,
  };
}

function addDeposit(state, amountA, amountB) {
  const lpFromA = (amountA * state.totalSupply) / state.reserveA;
  const lpFromB = (amountB * state.totalSupply) / state.reserveB;
  const minted = lpFromA < lpFromB ? lpFromA : lpFromB;
  return {
    ...state,
    mintedToProvider: minted,
    totalSupply: state.totalSupply + minted,
    reserveA: state.reserveA + amountA,
    reserveB: state.reserveB + amountB,
  };
}

function removeLiquidity(state, lpTokens) {
  return {
    amountA: (lpTokens * state.reserveA) / state.totalSupply,
    amountB: (lpTokens * state.reserveB) / state.totalSupply,
  };
}

test("first deposit locks MINIMUM_LIQUIDITY at address zero", () => {
  assert.match(source, /uint256 public constant MINIMUM_LIQUIDITY = 1000;/);
  assert.match(source, /uint256 public lockedLiquidity;/);
  assert.match(source, /lockedLiquidity = MINIMUM_LIQUIDITY;/);
  assert.match(source, /lpTokens = initialLiquidity - MINIMUM_LIQUIDITY;/);
  assert.match(source, /if \(account == address\(0\)\) return lockedLiquidity;/);

  assert.deepEqual(firstDeposit(1_000_000n, 1_000_000n), {
    lockedLiquidity: 1_000n,
    mintedToProvider: 999_000n,
    totalSupply: 1_000_000n,
    reserveA: 1_000_000n,
    reserveB: 1_000_000n,
  });
});

test("tiny first-depositor price manipulation attempt is rejected", () => {
  assert.throws(() => firstDeposit(1n, 1_000_000n), /Insufficient initial liquidity/);
  assert.match(source, /require\(initialLiquidity > MINIMUM_LIQUIDITY, "Insufficient initial liquidity"\);/);
});

test("subsequent deposits use proportional internal-reserve formula", () => {
  const state = firstDeposit(1_000_000n, 2_000_000n);
  const next = addDeposit(state, 100_000n, 200_000n);

  assert.equal(next.mintedToProvider, 141_421n);
  assert.match(source, /uint256 lpFromA = amountA \* totalSupply\(\) \/ reserveA;/);
  assert.match(source, /uint256 lpFromB = amountB \* totalSupply\(\) \/ reserveB;/);
});

test("removeLiquidity uses internal reserves and ignores direct donation balances", () => {
  const state = firstDeposit(1_000_000n, 1_000_000n);
  const providerLp = state.mintedToProvider;
  const beforeDonation = removeLiquidity(state, providerLp / 10n);
  const afterDonation = removeLiquidity({ ...state, actualA: 9_000_000n, actualB: 9_000_000n }, providerLp / 10n);

  assert.deepEqual(afterDonation, beforeDonation);
  assert.match(source, /amountA = lpTokens \* reserveA \/ totalSupply\(\);/);
  assert.match(source, /amountB = lpTokens \* reserveB \/ totalSupply\(\);/);
  assert.doesNotMatch(source, /uint256 balA = tokenA\.balanceOf\(address\(this\)\);/);
});

test("sync updates reserves from actual balances and emits Sync", () => {
  assert.match(source, /event Sync\(uint256 reserveA, uint256 reserveB\);/);
  assert.match(source, /function sync\(\) external/);
  assert.match(source, /reserveA = tokenA\.balanceOf\(address\(this\)\);/);
  assert.match(source, /reserveB = tokenB\.balanceOf\(address\(this\)\);/);
  assert.match(source, /emit Sync\(reserveA, reserveB\);/);
});

test("token transfers require success", () => {
  assert.match(source, /require\(tokenA\.transferFrom\(msg\.sender, address\(this\), amountA\), "TokenA transfer failed"\);/);
  assert.match(source, /require\(tokenB\.transferFrom\(msg\.sender, address\(this\), amountB\), "TokenB transfer failed"\);/);
  assert.match(source, /require\(tokenA\.transfer\(msg\.sender, amountA\), "TokenA transfer failed"\);/);
  assert.match(source, /require\(tokenB\.transfer\(msg\.sender, amountB\), "TokenB transfer failed"\);/);
});
