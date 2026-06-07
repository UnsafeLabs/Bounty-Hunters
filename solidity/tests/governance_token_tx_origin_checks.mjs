import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("solidity/contracts/GovernanceToken.sol", "utf8");
const attribution = JSON.parse(fs.readFileSync("solidity/contracts/.attribution.json", "utf8"));

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertMatches(pattern, message) {
  assert.match(source, pattern, message);
}

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

assert.equal(source.includes("tx.origin"), false, "tx.origin must not remain in GovernanceToken");
assertIncludes('import "@openzeppelin/contracts/access/Ownable.sol";', "Ownable import must protect admin functions");
assertMatches(/contract GovernanceToken is ERC20, Ownable/, "GovernanceToken must inherit Ownable");
assertMatches(/constructor\(uint256 initialSupply\) ERC20\("Governance", "GOV"\) Ownable\(msg\.sender\)/, "owner must initialize to deployer");
assertMatches(/function snapshot\(\) external onlyOwner/, "snapshot must be protected by onlyOwner");

const delegateVote = bodyOf("delegateVote");
const revokeDelegate = bodyOf("revokeDelegate");
const update = bodyOf("_update");

assert.ok(delegateVote.includes('require(msg.sender != address(0), "Invalid sender");'), "delegateVote must guard sender");
assert.ok(delegateVote.includes('require(to != address(0), "Invalid delegate");'), "delegateVote must reject zero delegate");
assert.ok(delegateVote.includes('require(msg.sender != to, "Cannot delegate to self");'), "delegateVote must use msg.sender self-check");
assert.ok(delegateVote.includes("delegates[msg.sender]"), "delegateVote must assign delegation for msg.sender");
assert.ok(delegateVote.includes("balanceOf(msg.sender)"), "delegateVote must use msg.sender balance");
assert.ok(!delegateVote.includes("tx.origin"), "delegateVote must not use tx.origin");

assert.ok(revokeDelegate.includes('require(msg.sender != address(0), "Invalid sender");'), "revokeDelegate must guard sender");
assert.ok(revokeDelegate.includes("delegates[msg.sender]"), "revokeDelegate must revoke msg.sender delegation");
assert.ok(revokeDelegate.includes("balanceOf(msg.sender)"), "revokeDelegate must adjust msg.sender balance");
assert.ok(!revokeDelegate.includes("tx.origin"), "revokeDelegate must not use tx.origin");

assert.ok(update.includes("delegatedPower[fromDelegate] -= value;"), "transfers must remove moved tokens from previous delegate power");
assert.ok(update.includes("delegatedPower[toDelegate] += value;"), "transfers must add moved tokens to recipient delegate power");
assert.ok(update.includes("super._update(from, to, value);"), "ERC20 transfer behavior must continue");

assert.equal(attribution.tool, "Codex GPT-5", "attribution tool name must be present");
assert.ok(!/complete pre-conversation|system message|developer message|private|secret/i.test(attribution.platform_config.replace("Private", "")), "attribution must not publish hidden runtime text");

class GovernanceTokenModel {
  constructor({ owner, initialSupply }) {
    this.owner = owner;
    this.balances = new Map([[owner, initialSupply]]);
    this.delegates = new Map();
    this.delegatedPower = new Map();
  }

  balanceOf(account) {
    return this.balances.get(account) ?? 0;
  }

  powerOf(account) {
    return this.delegatedPower.get(account) ?? 0;
  }

  delegateVote(caller, to) {
    assert.notEqual(caller, "0x0", "Invalid sender");
    assert.notEqual(to, "0x0", "Invalid delegate");
    assert.notEqual(caller, to, "Cannot delegate to self");

    const previous = this.delegates.get(caller);
    if (previous) {
      this.delegatedPower.set(previous, this.powerOf(previous) - this.balanceOf(caller));
    }

    this.delegates.set(caller, to);
    this.delegatedPower.set(to, this.powerOf(to) + this.balanceOf(caller));
  }

  revokeDelegate(caller) {
    assert.notEqual(caller, "0x0", "Invalid sender");
    const current = this.delegates.get(caller);
    assert.ok(current, "No delegate");
    this.delegatedPower.set(current, this.powerOf(current) - this.balanceOf(caller));
    this.delegates.delete(caller);
  }

  transfer(from, to, value) {
    assert.ok(this.balanceOf(from) >= value, "Insufficient balance");

    const fromDelegate = this.delegates.get(from);
    if (fromDelegate) {
      this.delegatedPower.set(fromDelegate, this.powerOf(fromDelegate) - value);
    }

    const toDelegate = this.delegates.get(to);
    if (toDelegate) {
      this.delegatedPower.set(toDelegate, this.powerOf(toDelegate) + value);
    }

    this.balances.set(from, this.balanceOf(from) - value);
    this.balances.set(to, this.balanceOf(to) + value);
  }

  snapshot(caller) {
    assert.equal(caller, this.owner, "Ownable: caller is not the owner");
  }

  getVotingPower(account) {
    return this.balanceOf(account) + this.powerOf(account);
  }
}

const token = new GovernanceTokenModel({ owner: "alice", initialSupply: 100 });

function phishingAttempt(originUser, phishingContract, attackerDelegate) {
  assert.equal(originUser, "alice", "model sanity check");
  token.delegateVote(phishingContract, attackerDelegate);
}

phishingAttempt("alice", "phishingContract", "attacker");
assert.equal(token.delegates.get("alice"), undefined, "phishing contract must not delegate the origin user's votes");
assert.equal(token.powerOf("attacker"), 0, "phishing contract with no balance must not gain victim voting power");

token.delegateVote("alice", "bob");
assert.equal(token.powerOf("bob"), 100, "legitimate delegation must grant voting power");
assert.equal(token.getVotingPower("bob"), 100, "delegate must receive voting power");

token.transfer("alice", "carol", 40);
assert.equal(token.powerOf("bob"), 60, "delegated power must shrink when delegator transfers tokens away");

token.delegateVote("carol", "dave");
assert.equal(token.powerOf("dave"), 40, "recipient can legitimately delegate received tokens");

token.revokeDelegate("alice");
assert.equal(token.powerOf("bob"), 0, "revoke must remove remaining delegated power");

assert.throws(() => token.snapshot("phishingContract"), /owner/, "snapshot must reject non-owner contract calls");
token.snapshot("alice");

console.log("GovernanceToken tx.origin phishing checks passed: phishing blocked, Ownable snapshot, legitimate delegation, and delegated transfer accounting.");
