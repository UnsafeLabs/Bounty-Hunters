import assert from "node:assert/strict";
import test from "node:test";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADMIN = "admin";
const ALICE = "alice";
const BOB = "bob";
const CAROL = "carol";
const PHISHING_CONTRACT = "phishing-contract";
const LEGIT_CONTRACT = "legit-contract";

class GovernanceTokenModel {
  constructor(initialSupply, admin = ADMIN) {
    this.admin = admin;
    this.balances = new Map([[admin, BigInt(initialSupply)]]);
    this.delegates = new Map();
    this.delegatedPower = new Map();
    this.proposals = [];
    this.hasVoted = new Set();
    this.events = [];
    this.now = 1n;
  }

  balanceOf(account) {
    return this.balances.get(account) ?? 0n;
  }

  delegated(account) {
    return this.delegatedPower.get(account) ?? 0n;
  }

  mint(account, amount) {
    this.transferPower(ZERO_ADDRESS, account, BigInt(amount));
    this.balances.set(account, this.balanceOf(account) + BigInt(amount));
  }

  transfer(from, to, amount) {
    amount = BigInt(amount);
    assert(this.balanceOf(from) >= amount, "insufficient balance");
    this.transferPower(from, to, amount);
    this.balances.set(from, this.balanceOf(from) - amount);
    this.balances.set(to, this.balanceOf(to) + amount);
  }

  transferPower(from, to, amount) {
    if (from !== ZERO_ADDRESS) {
      const fromDelegate = this.delegates.get(from) ?? ZERO_ADDRESS;
      if (fromDelegate !== ZERO_ADDRESS) {
        this.delegatedPower.set(fromDelegate, this.delegated(fromDelegate) - amount);
      }
    }

    if (to !== ZERO_ADDRESS) {
      const toDelegate = this.delegates.get(to) ?? ZERO_ADDRESS;
      if (toDelegate !== ZERO_ADDRESS) {
        this.delegatedPower.set(toDelegate, this.delegated(toDelegate) + amount);
      }
    }
  }

  delegateVote(sender, to) {
    assert(sender !== ZERO_ADDRESS, "Invalid sender");
    assert(to !== ZERO_ADDRESS, "Invalid delegate");
    assert(sender !== to, "Cannot delegate to self");

    const previous = this.delegates.get(sender) ?? ZERO_ADDRESS;
    const balance = this.balanceOf(sender);
    if (previous !== ZERO_ADDRESS) {
      this.delegatedPower.set(previous, this.delegated(previous) - balance);
    }

    this.delegates.set(sender, to);
    this.delegatedPower.set(to, this.delegated(to) + balance);
    this.events.push(["DelegateChanged", sender, to]);
  }

  revokeDelegate(sender) {
    assert(sender !== ZERO_ADDRESS, "Invalid sender");
    const current = this.delegates.get(sender) ?? ZERO_ADDRESS;
    assert(current !== ZERO_ADDRESS, "No delegate");

    this.delegatedPower.set(current, this.delegated(current) - this.balanceOf(sender));
    this.delegates.set(sender, ZERO_ADDRESS);
    this.events.push(["DelegateChanged", sender, ZERO_ADDRESS]);
  }

  snapshot(sender) {
    assert(sender === this.admin, "Not admin");
    this.events.push(["Snapshot", this.now]);
  }

  getVotingPower(account) {
    const ownPower = (this.delegates.get(account) ?? ZERO_ADDRESS) === ZERO_ADDRESS
      ? this.balanceOf(account)
      : 0n;
    return ownPower + this.delegated(account);
  }

  createProposal(description, duration) {
    const proposalId = this.proposals.length;
    this.proposals.push({
      description,
      forVotes: 0n,
      againstVotes: 0n,
      endTime: this.now + BigInt(duration),
      executed: false,
    });
    return proposalId;
  }

  vote(sender, proposalId, support) {
    const proposal = this.proposals[proposalId];
    assert(this.now < proposal.endTime, "Voting ended");
    const key = `${proposalId}:${sender}`;
    assert(!this.hasVoted.has(key), "Already voted");

    const power = this.getVotingPower(sender);
    assert(power > 0n, "No voting power");
    this.hasVoted.add(key);
    if (support) {
      proposal.forVotes += power;
    } else {
      proposal.againstVotes += power;
    }
  }
}

function setup() {
  const token = new GovernanceTokenModel(1_000n);
  token.transfer(ADMIN, ALICE, 100n);
  token.transfer(ADMIN, BOB, 50n);
  token.transfer(ADMIN, LEGIT_CONTRACT, 25n);
  return token;
}

test("phishing contract cannot delegate a user's votes through an origin-style flow", () => {
  const token = setup();

  token.delegateVote(PHISHING_CONTRACT, BOB);

  assert.equal(token.delegates.get(ALICE), undefined);
  assert.equal(token.delegated(BOB), 0n);
  assert.equal(token.delegated(PHISHING_CONTRACT), 0n);
});

test("legitimate delegation and voting use msg.sender and avoid double counting", () => {
  const token = setup();
  const proposalId = token.createProposal("ship it", 100n);

  token.delegateVote(ALICE, BOB);
  assert.equal(token.getVotingPower(ALICE), 0n);
  assert.equal(token.getVotingPower(BOB), 150n);
  token.vote(BOB, proposalId, true);

  assert.equal(token.proposals[proposalId].forVotes, 150n);
});

test("contract-owned tokens can be delegated by the contract itself", () => {
  const token = setup();

  token.delegateVote(LEGIT_CONTRACT, CAROL);

  assert.equal(token.getVotingPower(LEGIT_CONTRACT), 0n);
  assert.equal(token.getVotingPower(CAROL), 25n);
});

test("delegated power follows token transfers after delegation", () => {
  const token = setup();

  token.delegateVote(ALICE, BOB);
  token.transfer(ALICE, CAROL, 40n);

  assert.equal(token.getVotingPower(BOB), 110n);
  assert.equal(token.getVotingPower(CAROL), 40n);
});

test("revoke restores own voting power and removes delegated power", () => {
  const token = setup();

  token.delegateVote(ALICE, BOB);
  token.revokeDelegate(ALICE);

  assert.equal(token.getVotingPower(ALICE), 100n);
  assert.equal(token.getVotingPower(BOB), 50n);
});

test("snapshot is owner-only", () => {
  const token = setup();

  assert.throws(() => token.snapshot(ALICE), /Not admin/);
  token.snapshot(ADMIN);
  assert.deepEqual(token.events.at(-1), ["Snapshot", 1n]);
});

test("invalid delegate targets are rejected", () => {
  const token = setup();

  assert.throws(() => token.delegateVote(ALICE, ZERO_ADDRESS), /Invalid delegate/);
  assert.throws(() => token.delegateVote(ALICE, ALICE), /Cannot delegate to self/);
});
