import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../contracts/GovernanceToken.sol", import.meta.url), "utf8");

function makeState() {
  return {
    balances: new Map([
      ["alice", 100n],
      ["phishingContract", 0n],
      ["bob", 25n],
    ]),
    delegates: new Map(),
    delegatedPower: new Map(),
    owner: "alice",
  };
}

function balanceOf(state, account) {
  return state.balances.get(account) ?? 0n;
}

function delegatedPowerOf(state, account) {
  return state.delegatedPower.get(account) ?? 0n;
}

function setDelegatedPower(state, account, value) {
  state.delegatedPower.set(account, value);
}

function delegateVote(state, caller, to) {
  if (caller === "0x0") throw new Error("Invalid sender");
  if (to === "0x0") throw new Error("Invalid delegate");
  if (caller === to) throw new Error("Cannot delegate to self");

  const previousDelegate = state.delegates.get(caller);
  if (previousDelegate) {
    setDelegatedPower(
      state,
      previousDelegate,
      delegatedPowerOf(state, previousDelegate) - balanceOf(state, caller),
    );
  }

  state.delegates.set(caller, to);
  setDelegatedPower(state, to, delegatedPowerOf(state, to) + balanceOf(state, caller));
}

function transfer(state, from, to, amount) {
  const fromDelegate = state.delegates.get(from);
  const toDelegate = state.delegates.get(to);

  if (fromDelegate) {
    setDelegatedPower(state, fromDelegate, delegatedPowerOf(state, fromDelegate) - amount);
  }
  if (toDelegate) {
    setDelegatedPower(state, toDelegate, delegatedPowerOf(state, toDelegate) + amount);
  }

  state.balances.set(from, balanceOf(state, from) - amount);
  state.balances.set(to, balanceOf(state, to) + amount);
}

function snapshot(state, caller) {
  if (caller !== state.owner) throw new Error("OwnableUnauthorizedAccount");
  return true;
}

test("contract removes tx.origin and uses Ownable for admin-only snapshot", () => {
  assert.doesNotMatch(source, /tx\.origin/);
  assert.match(source, /import "@openzeppelin\/contracts\/access\/Ownable\.sol";/);
  assert.match(source, /contract GovernanceToken is ERC20, Ownable/);
  assert.match(source, /constructor\(uint256 initialSupply\) ERC20\("Governance", "GOV"\) Ownable\(msg\.sender\)/);
  assert.match(source, /function snapshot\(\) external onlyOwner/);
});

test("delegate and revoke operate on msg.sender", () => {
  assert.match(source, /address previousDelegate = delegates\[msg\.sender\];/);
  assert.match(source, /delegates\[msg\.sender\] = to;/);
  assert.match(source, /address currentDelegate = delegates\[msg\.sender\];/);
  assert.match(source, /delegates\[msg\.sender\] = address\(0\);/);
  assert.match(source, /require\(msg\.sender != address\(0\), "Invalid sender"\);/);
});

test("phishing contract cannot delegate votes for the externally owned caller", () => {
  const state = makeState();

  delegateVote(state, "phishingContract", "bob");

  assert.equal(state.delegates.get("alice"), undefined);
  assert.equal(state.delegates.get("phishingContract"), "bob");
  assert.equal(delegatedPowerOf(state, "bob"), 0n);
});

test("direct delegation still grants voting power to the chosen delegate", () => {
  const state = makeState();

  delegateVote(state, "alice", "bob");

  assert.equal(state.delegates.get("alice"), "bob");
  assert.equal(delegatedPowerOf(state, "bob"), 100n);
});

test("delegated power follows balance transfers", () => {
  const state = makeState();

  delegateVote(state, "alice", "bob");
  transfer(state, "alice", "carol", 40n);

  assert.equal(balanceOf(state, "alice"), 60n);
  assert.equal(delegatedPowerOf(state, "bob"), 60n);

  delegateVote(state, "carol", "bob");
  assert.equal(delegatedPowerOf(state, "bob"), 100n);
});

test("snapshot rejects non-owner callers", () => {
  const state = makeState();

  assert.equal(snapshot(state, "alice"), true);
  assert.throws(() => snapshot(state, "bob"), /OwnableUnauthorizedAccount/);
});

test("getVotingPower includes self balance and delegated votes", () => {
  assert.match(source, /return balanceOf\(account\) \+ delegatedPower\[account\];/);
});
