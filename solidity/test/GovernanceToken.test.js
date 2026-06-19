const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ganache = require('ganache');
const solc = require('solc');
const { ethers } = require('ethers');

const ONE = 10n ** 18n;
const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts');
const NODE_MODULES_DIR = path.join(__dirname, '..', 'node_modules');

const helperSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernanceToken {
    function delegateVote(address to) external;
    function revokeDelegate() external;
    function snapshot() external;
}

contract PhishingDelegate {
    function phishDelegate(address token, address to) external {
        IGovernanceToken(token).delegateVote(to);
    }

    function phishSnapshot(address token) external {
        IGovernanceToken(token).snapshot();
    }
}

contract DelegatingWallet {
    function delegate(address token, address to) external {
        IGovernanceToken(token).delegateVote(to);
    }

    function revoke(address token) external {
        IGovernanceToken(token).revokeDelegate();
    }
}
`;

function readSource(file) {
  return fs.readFileSync(path.join(CONTRACTS_DIR, file), 'utf8');
}

function resolveImport(importPath) {
  const candidates = [
    path.join(NODE_MODULES_DIR, importPath),
    path.join(CONTRACTS_DIR, importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, 'utf8') };
    }
  }

  return { error: `File not found: ${importPath}` };
}

function compileContracts() {
  const source = readSource('GovernanceToken.sol');
  assert(!source.includes('tx.origin'), 'GovernanceToken.sol must not use tx.origin');

  const input = {
    language: 'Solidity',
    sources: {
      'contracts/GovernanceToken.sol': { content: source },
      'test/GovernanceHelpers.sol': { content: helperSource },
    },
    settings: {
      evmVersion: 'paris',
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepStrictEqual(errors, []);

  return {
    GovernanceToken: output.contracts['contracts/GovernanceToken.sol'].GovernanceToken,
    PhishingDelegate: output.contracts['test/GovernanceHelpers.sol'].PhishingDelegate,
    DelegatingWallet: output.contracts['test/GovernanceHelpers.sol'].DelegatingWallet,
  };
}

async function deploy(compiled, signer, args = []) {
  const factory = new ethers.ContractFactory(compiled.abi, compiled.evm.bytecode.object, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function expectRevert(promise, pattern) {
  await assert.rejects(promise, pattern);
}

describe('GovernanceToken delegation authorization', function () {
  this.timeout(30000);

  let compiled;
  let provider;
  let owner;
  let voter;
  let delegatee;
  let attacker;
  let recipient;
  let token;

  before(function () {
    compiled = compileContracts();
  });

  beforeEach(async function () {
    const ganacheProvider = ganache.provider({ chain: { hardfork: 'shanghai' }, logging: { quiet: true } });
    provider = new ethers.BrowserProvider(ganacheProvider);
    [owner, voter, delegatee, attacker, recipient] = await Promise.all(
      [0, 1, 2, 3, 4].map((index) => provider.getSigner(index))
    );

    token = await deploy(compiled.GovernanceToken, owner, [1_000n * ONE]);
    await (await token.transfer(await voter.getAddress(), 100n * ONE)).wait();
    await (await token.transfer(await recipient.getAddress(), 25n * ONE)).wait();
  });

  it('uses msg.sender for delegation so a phishing contract cannot delegate user votes', async function () {
    const phishing = await deploy(compiled.PhishingDelegate, attacker);
    const phishingAddress = await phishing.getAddress();
    const attackerAddress = await attacker.getAddress();
    const voterAddress = await voter.getAddress();

    await (await phishing.connect(voter).phishDelegate(await token.getAddress(), attackerAddress)).wait();

    assert.equal(await token.delegates(voterAddress), ethers.ZeroAddress);
    assert.equal(await token.delegates(phishingAddress), attackerAddress);
    assert.equal(await token.delegatedPower(attackerAddress), 0n);
    assert.equal(await token.getVotingPower(voterAddress), 100n * ONE);
  });

  it('allows legitimate contract-held tokens to delegate through msg.sender', async function () {
    const wallet = await deploy(compiled.DelegatingWallet, voter);
    const walletAddress = await wallet.getAddress();
    const delegateeAddress = await delegatee.getAddress();

    await (await token.connect(voter).transfer(walletAddress, 40n * ONE)).wait();
    await (await wallet.connect(voter).delegate(await token.getAddress(), delegateeAddress)).wait();

    assert.equal(await token.delegates(walletAddress), delegateeAddress);
    assert.equal(await token.delegatedPower(delegateeAddress), 40n * ONE);
    assert.equal(await token.getVotingPower(walletAddress), 0n);
    assert.equal(await token.getVotingPower(delegateeAddress), 40n * ONE);
  });

  it('keeps delegated voting power synchronized when delegated balances move', async function () {
    const voterAddress = await voter.getAddress();
    const delegateeAddress = await delegatee.getAddress();
    const recipientAddress = await recipient.getAddress();

    await (await token.connect(voter).delegateVote(delegateeAddress)).wait();
    assert.equal(await token.getVotingPower(voterAddress), 0n);
    assert.equal(await token.getVotingPower(delegateeAddress), 100n * ONE);

    await (await token.connect(voter).transfer(recipientAddress, 30n * ONE)).wait();
    assert.equal(await token.delegatedPower(delegateeAddress), 70n * ONE);
    assert.equal(await token.getVotingPower(delegateeAddress), 70n * ONE);

    await (await token.connect(recipient).delegateVote(delegateeAddress)).wait();
    assert.equal(await token.delegatedPower(delegateeAddress), 125n * ONE);
  });

  it('restores direct voting power when a user revokes delegation', async function () {
    const voterAddress = await voter.getAddress();
    const delegateeAddress = await delegatee.getAddress();

    await (await token.connect(voter).delegateVote(delegateeAddress)).wait();
    await (await token.connect(voter).revokeDelegate()).wait();

    assert.equal(await token.delegates(voterAddress), ethers.ZeroAddress);
    assert.equal(await token.delegatedPower(delegateeAddress), 0n);
    assert.equal(await token.getVotingPower(voterAddress), 100n * ONE);
  });

  it('uses Ownable msg.sender authorization for snapshot', async function () {
    const phishing = await deploy(compiled.PhishingDelegate, attacker);

    await (await token.connect(owner).snapshot()).wait();
    await expectRevert(
      token.connect(attacker).snapshot(),
      /OwnableUnauthorizedAccount|missing revert data|execution reverted/
    );
    await expectRevert(
      phishing.connect(owner).phishSnapshot(await token.getAddress()),
      /OwnableUnauthorizedAccount|missing revert data|execution reverted/
    );
  });

  it('keeps proposal voting compatible with delegated voting power', async function () {
    const delegateeAddress = await delegatee.getAddress();

    await (await token.connect(voter).delegateVote(delegateeAddress)).wait();
    const proposalId = await token.createProposal.staticCall('ship fix', 3600);
    await (await token.createProposal('ship fix', 3600)).wait();

    await expectRevert(
      token.connect(voter).vote(proposalId, true),
      /No voting power|missing revert data|execution reverted/
    );
    await (await token.connect(delegatee).vote(proposalId, true)).wait();

    const proposal = await token.proposals(proposalId);
    assert.equal(proposal.forVotes, 100n * ONE);
    assert.equal(proposal.againstVotes, 0n);
  });

  it('rejects invalid delegation targets', async function () {
    await expectRevert(
      token.connect(voter).delegateVote(await voter.getAddress()),
      /Cannot delegate to self|missing revert data|execution reverted/
    );
    await expectRevert(
      token.connect(voter).delegateVote(ethers.ZeroAddress),
      /Invalid delegate|missing revert data|execution reverted/
    );
  });
});
