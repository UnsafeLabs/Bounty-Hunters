const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const bridgePath = path.join(__dirname, "..", "contracts", "CrossChainBridge.sol");

const ierc20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
`;

const mockErc20Source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC20 {
    string public name = "Mock Token";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
`;

const transferTypes = {
  BridgeTransfer: [
    { name: "sourceSender", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "solidity/contracts/CrossChainBridge.sol": {
        content: fs.readFileSync(bridgePath, "utf8"),
      },
      "@openzeppelin/contracts/token/ERC20/IERC20.sol": {
        content: ierc20Source,
      },
      "solidity/test/MockERC20.sol": {
        content: mockErc20Source,
      },
    },
    settings: {
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
  assert.deepEqual(errors, []);
  return output.contracts;
}

function artifact(contracts, source, contractName) {
  const contract = contracts[source][contractName];
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

async function deploy(factory, ...args) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function mine(transaction) {
  const response = await transaction;
  return response.wait();
}

async function setup({ chainId = 31337, validator = ethers.Wallet.createRandom() } = {}) {
  const provider = new ethers.BrowserProvider(
    ganache.provider({ chain: { chainId }, logging: { quiet: true }, wallet: { totalAccounts: 3 } }),
  );
  const owner = await provider.getSigner(0);
  const recipient = await provider.getSigner(1);
  const alternateRecipient = await provider.getSigner(2);
  const contracts = compileContracts();

  const tokenArtifact = artifact(contracts, "solidity/test/MockERC20.sol", "MockERC20");
  const token = await deploy(new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, owner));

  const bridgeArtifact = artifact(contracts, "solidity/contracts/CrossChainBridge.sol", "CrossChainBridge");
  const bridge = await deploy(
    new ethers.ContractFactory(bridgeArtifact.abi, bridgeArtifact.bytecode, owner),
    await token.getAddress(),
    validator.address,
  );

  await mine(token.mint(await bridge.getAddress(), 1_000_000n));
  return { provider, owner, recipient, alternateRecipient, validator, token, bridge, bridgeArtifact };
}

async function domain(provider, bridge) {
  const network = await provider.getNetwork();
  return {
    name: "CrossChainBridge",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await bridge.getAddress(),
  };
}

async function signTransfer({ provider, bridge, validator, sourceSender, recipient, amount, nonce }) {
  return validator.signTypedData(await domain(provider, bridge), transferTypes, {
    sourceSender,
    recipient,
    amount,
    nonce,
  });
}

describe("CrossChainBridge", () => {
  it("builds an EIP-712 domain from the live chain ID and bridge address", async () => {
    const { provider, bridge } = await setup();

    assert.equal(await bridge.domainSeparator(), ethers.TypedDataEncoder.hashDomain(await domain(provider, bridge)));
  });

  it("processes a validator-signed bridge transfer and advances only the source sender nonce", async () => {
    const { provider, owner, recipient, validator, token, bridge } = await setup();
    const sourceSender = await owner.getAddress();
    const recipientAddress = await recipient.getAddress();
    const signature = await signTransfer({
      provider,
      bridge,
      validator,
      sourceSender,
      recipient: recipientAddress,
      amount: 500n,
      nonce: 0n,
    });
    const digest = await bridge.hashTransfer(sourceSender, recipientAddress, 500n, 0n);

    assert.equal(await bridge.verifySignature(digest, signature), true);
    await mine(bridge.processTransfer(sourceSender, recipientAddress, 500n, 0n, signature));

    assert.equal(await token.balanceOf(recipientAddress), 500n);
    assert.equal(await bridge.inboundNonces(sourceSender), 1n);
  });

  it("rejects same-chain replay of a consumed source-sender nonce", async () => {
    const { provider, owner, recipient, validator, token, bridge } = await setup();
    const sourceSender = await owner.getAddress();
    const recipientAddress = await recipient.getAddress();
    const signature = await signTransfer({
      provider,
      bridge,
      validator,
      sourceSender,
      recipient: recipientAddress,
      amount: 250n,
      nonce: 0n,
    });

    await mine(bridge.processTransfer(sourceSender, recipientAddress, 250n, 0n, signature));
    await assert.rejects(mine(bridge.processTransfer(sourceSender, recipientAddress, 250n, 0n, signature)));

    assert.equal(await token.balanceOf(recipientAddress), 250n);
  });

  it("does not let one source sender consume another source sender signature", async () => {
    const { provider, owner, recipient, alternateRecipient, validator, bridge } = await setup();
    const sourceSender = await owner.getAddress();
    const recipientAddress = await recipient.getAddress();
    const attackerSourceSender = await alternateRecipient.getAddress();
    const signature = await signTransfer({
      provider,
      bridge,
      validator,
      sourceSender,
      recipient: recipientAddress,
      amount: 100n,
      nonce: 0n,
    });

    await assert.rejects(bridge.processTransfer(attackerSourceSender, recipientAddress, 100n, 0n, signature));
  });

  it("rejects zero source sender and recipient addresses before signature processing", async () => {
    const { provider, owner, recipient, validator, bridge } = await setup();
    const sourceSender = await owner.getAddress();
    const recipientAddress = await recipient.getAddress();
    const signature = await signTransfer({
      provider,
      bridge,
      validator,
      sourceSender,
      recipient: recipientAddress,
      amount: 100n,
      nonce: 0n,
    });

    await assert.rejects(bridge.processTransfer(ethers.ZeroAddress, recipientAddress, 100n, 0n, signature));
    await assert.rejects(bridge.processTransfer(sourceSender, ethers.ZeroAddress, 100n, 0n, signature));
  });

  it("rejects replay against a replacement bridge contract on the same chain", async () => {
    const { provider, owner, recipient, validator, token, bridge, bridgeArtifact } = await setup();
    const sourceSender = await owner.getAddress();
    const recipientAddress = await recipient.getAddress();
    const signature = await signTransfer({
      provider,
      bridge,
      validator,
      sourceSender,
      recipient: recipientAddress,
      amount: 100n,
      nonce: 0n,
    });
    const replacement = await deploy(
      new ethers.ContractFactory(bridgeArtifact.abi, bridgeArtifact.bytecode, owner),
      await token.getAddress(),
      validator.address,
    );
    await mine(token.mint(await replacement.getAddress(), 1_000n));

    await assert.rejects(replacement.processTransfer(sourceSender, recipientAddress, 100n, 0n, signature));
  });

  it("rejects replay on a different chain ID", async () => {
    const validator = ethers.Wallet.createRandom();
    const source = await setup({ chainId: 31337, validator });
    const destination = await setup({ chainId: 31338, validator });
    const sourceSender = await source.owner.getAddress();
    const recipientAddress = await destination.recipient.getAddress();
    const signature = await signTransfer({
      provider: source.provider,
      bridge: source.bridge,
      validator,
      sourceSender,
      recipient: recipientAddress,
      amount: 100n,
      nonce: 0n,
    });

    await assert.rejects(destination.bridge.processTransfer(sourceSender, recipientAddress, 100n, 0n, signature));
  });

  it("treats zero-address ecrecover results as invalid signatures", async () => {
    const { owner, recipient, bridge } = await setup();
    const sourceSender = await owner.getAddress();
    const recipientAddress = await recipient.getAddress();
    const digest = await bridge.hashTransfer(sourceSender, recipientAddress, 100n, 0n);
    const zeroSignature = `0x${"00".repeat(65)}`;

    assert.equal(await bridge.verifySignature(digest, zeroSignature), false);
    await assert.rejects(bridge.processTransfer(sourceSender, recipientAddress, 100n, 0n, zeroSignature));
  });

  it("uses per-sender outbound nonces for transfer initiation", async () => {
    const { owner, recipient, token, bridge } = await setup();
    const ownerAddress = await owner.getAddress();
    const recipientAddress = await recipient.getAddress();

    await mine(token.mint(ownerAddress, 1_000n));
    await mine(token.mint(recipientAddress, 1_000n));
    await mine(token.connect(owner).approve(await bridge.getAddress(), 1_000n));
    await mine(token.connect(recipient).approve(await bridge.getAddress(), 1_000n));
    await mine(bridge.connect(owner).initiateTransfer(100n, 2n));
    await mine(bridge.connect(recipient).initiateTransfer(150n, 2n));

    assert.equal(await bridge.outboundNonces(ownerAddress), 1n);
    assert.equal(await bridge.outboundNonces(recipientAddress), 1n);
  });
});
