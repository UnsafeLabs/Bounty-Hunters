const assert = require("node:assert/strict");
const { beforeEach, describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ganache = require("ganache");
const solc = require("solc");
const { ethers } = require("ethers");

const flashLoanPath = path.join(__dirname, "..", "contracts", "FlashLoan.sol");

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

const mockSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IFlashLoanLike {
    function flashLoan(uint256 amount, bytes calldata data) external;
}

interface IFlashLoanReceiverLike {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

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

contract GoodBorrower is IFlashLoanReceiverLike {
    address public lender;
    uint256 public lastFee;

    function executeLoan(address _lender, uint256 amount) external {
        lender = _lender;
        IFlashLoanLike(_lender).flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        require(msg.sender == lender, "bad lender");
        lastFee = fee;
        IERC20Like(token).approve(msg.sender, amount + fee);
    }
}

contract BalanceManipulatingBorrower is IFlashLoanReceiverLike {
    address public lender;

    function executeLoan(address _lender, uint256 amount) external {
        lender = _lender;
        IFlashLoanLike(_lender).flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        MockERC20(token).mint(lender, amount + fee);
    }
}
`;

function compileContracts() {
    const input = {
        language: "Solidity",
        sources: {
            "solidity/contracts/FlashLoan.sol": {
                content: fs.readFileSync(flashLoanPath, "utf8"),
            },
            "@openzeppelin/contracts/token/ERC20/IERC20.sol": {
                content: ierc20Source,
            },
            "solidity/test/FlashLoanMocks.sol": {
                content: mockSource,
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

function artifact(contracts, source, name) {
    const contract = contracts[source][name];
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

async function send(transaction) {
    const response = await transaction;
    return response.wait();
}

describe("FlashLoan", () => {
    let provider;
    let owner;
    let contracts;
    let token;
    let lender;
    let goodBorrower;
    let badBorrower;

    beforeEach(async () => {
        provider = new ethers.BrowserProvider(
            ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 3 } }),
        );
        owner = await provider.getSigner(0);
        contracts = compileContracts();

        const tokenFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/test/FlashLoanMocks.sol", "MockERC20").abi,
            artifact(contracts, "solidity/test/FlashLoanMocks.sol", "MockERC20").bytecode,
            owner,
        );
        token = await deploy(tokenFactory);

        const lenderFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/contracts/FlashLoan.sol", "FlashLoan").abi,
            artifact(contracts, "solidity/contracts/FlashLoan.sol", "FlashLoan").bytecode,
            owner,
        );
        lender = await deploy(lenderFactory, await token.getAddress(), 30);

        const goodFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/test/FlashLoanMocks.sol", "GoodBorrower").abi,
            artifact(contracts, "solidity/test/FlashLoanMocks.sol", "GoodBorrower").bytecode,
            owner,
        );
        goodBorrower = await deploy(goodFactory);

        const badFactory = new ethers.ContractFactory(
            artifact(contracts, "solidity/test/FlashLoanMocks.sol", "BalanceManipulatingBorrower").abi,
            artifact(contracts, "solidity/test/FlashLoanMocks.sol", "BalanceManipulatingBorrower").bytecode,
            owner,
        );
        badBorrower = await deploy(badFactory);

        await send(token.mint(await owner.getAddress(), 1_000_000n));
        await send(token.approve(await lender.getAddress(), 1_000_000n));
        await send(lender.depositToPool(100_000n));
    });

    it("charges a minimum one-unit fee for small flash loans", async () => {
        await send(token.mint(await goodBorrower.getAddress(), 1n));

        await send(goodBorrower.executeLoan(await lender.getAddress(), 1n));

        assert.equal(await goodBorrower.lastFee(), 1n);
        assert.equal(await lender.totalFees(), 1n);
        assert.equal(await lender.getPoolBalance(), 100_001n);
    });

    it("rejects loans above half of the internally tracked pool", async () => {
        await assert.rejects(
            goodBorrower.executeLoan(await lender.getAddress(), 50_001n),
        );
    });

    it("keeps rebasing or donated balances out of pool accounting", async () => {
        await send(token.mint(await lender.getAddress(), 1_000_000n));

        assert.equal(await token.balanceOf(await lender.getAddress()), 1_100_000n);
        assert.equal(await lender.getPoolBalance(), 100_000n);
        await assert.rejects(
            goodBorrower.executeLoan(await lender.getAddress(), 500_001n),
        );
    });

    it("requires borrower repayment approval instead of trusting manipulated balances", async () => {
        await assert.rejects(
            badBorrower.executeLoan(await lender.getAddress(), 10_000n),
        );
        assert.equal(await lender.totalFees(), 0n);
        assert.equal(await lender.getPoolBalance(), 100_000n);
    });

    it("pauses and unpauses flash loans", async () => {
        await send(token.mint(await goodBorrower.getAddress(), 150n));

        await send(lender.pause());
        await assert.rejects(lender.flashLoan.staticCall(10_000n, "0x"));

        await send(lender.unpause());
        assert.equal(await lender.paused(), false);
        await send(goodBorrower.executeLoan(await lender.getAddress(), 10_000n));

        assert.equal(await lender.totalFees(), 30n);
    });

    it("tracks and withdraws accrued fees from the internal pool", async () => {
        const ownerBefore = await token.balanceOf(await owner.getAddress());
        await send(token.mint(await goodBorrower.getAddress(), 150n));

        await send(goodBorrower.executeLoan(await lender.getAddress(), 10_000n));
        await send(lender.withdrawFees());

        assert.equal(await lender.totalFees(), 0n);
        assert.equal(await lender.getPoolBalance(), 100_000n);
        assert.equal(await token.balanceOf(await owner.getAddress()), ownerBefore + 30n);
    });
});
