const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWallet", function () {
    let wallet, owner1, owner2, owner3, nonOwner, recipient;
    const REQUIRED = 2;

    beforeEach(async function () {
        [owner1, owner2, owner3, nonOwner, recipient] = await ethers.getSigners();

        const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
        wallet = await MultiSigWallet.deploy(
            [owner1.address, owner2.address, owner3.address],
            REQUIRED
        );
        await wallet.waitForDeployment();

        // Fund wallet for ETH transfer tests
        await owner1.sendTransaction({
            to: await wallet.getAddress(),
            value: ethers.parseEther("10")
        });
    });

    describe("Deployment", function () {
        it("should deploy with correct owners and required count", async function () {
            expect(await wallet.required()).to.equal(REQUIRED);
            expect(await wallet.owners(0)).to.equal(owner1.address);
            expect(await wallet.owners(1)).to.equal(owner2.address);
            expect(await wallet.owners(2)).to.equal(owner3.address);
            expect(await wallet.isOwner(owner1.address)).to.be.true;
            expect(await wallet.isOwner(nonOwner.address)).to.be.false;
        });

        it("should reject zero-address owners in constructor", async function () {
            const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
            await expect(
                MultiSigWallet.deploy(
                    [owner1.address, ethers.ZeroAddress],
                    1
                )
            ).to.be.revertedWith("Zero-address owner");
        });

        it("should reject empty owners array", async function () {
            const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
            await expect(
                MultiSigWallet.deploy([], 1)
            ).to.be.revertedWith("No owners");
        });

        it("should reject invalid required count", async function () {
            const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
            await expect(
                MultiSigWallet.deploy([owner1.address, owner2.address], 5)
            ).to.be.revertedWith("Invalid required");
        });
    });

    describe("submitTransaction", function () {
        it("should create a new transaction", async function () {
            const tx = await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("1"),
                "0x"
            );
            const receipt = await tx.wait();

            // Find the Submitted event
            const event = receipt.logs.find(log => log.fragment?.name === "Submitted");
            expect(event).to.not.be.undefined;

            const txn = await wallet.transactions(0);
            expect(txn.to).to.equal(recipient.address);
            expect(txn.value).to.equal(ethers.parseEther("1"));
            expect(txn.executed).to.be.false;
        });

        it("should reject zero-address recipient", async function () {
            await expect(
                wallet.connect(owner1).submitTransaction(
                    ethers.ZeroAddress,
                    0,
                    "0x"
                )
            ).to.be.revertedWith("Invalid recipient");
        });

        it("should require a contract target when data is provided", async function () {
            // recipient is an EOA (non-contract), so sending with data should fail
            await expect(
                wallet.connect(owner1).submitTransaction(
                    recipient.address,
                    0,
                    "0xdeadbeef"
                )
            ).to.be.revertedWith("Contract target required for data");
        });

        it("should allow EOA transfers without data", async function () {
            await expect(
                wallet.connect(owner1).submitTransaction(
                    recipient.address,
                    ethers.parseEther("1"),
                    "0x"
                )
            ).to.not.be.reverted;
        });

        it("should allow contract calls with data", async function () {
            // The wallet itself is a contract - submit to its receive function
            await expect(
                wallet.connect(owner1).submitTransaction(
                    await wallet.getAddress(),
                    0,
                    "0x"
                )
            ).to.not.be.reverted;
        });

        it("should not allow non-owners to submit", async function () {
            await expect(
                wallet.connect(nonOwner).submitTransaction(
                    recipient.address,
                    0,
                    "0x"
                )
            ).to.be.revertedWith("Not owner");
        });
    });

    describe("confirmTransaction", function () {
        beforeEach(async function () {
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("1"),
                "0x"
            );
        });

        it("should confirm a transaction", async function () {
            await wallet.connect(owner1).confirmTransaction(0);
            const count = await wallet.getConfirmationCount(0);
            expect(count).to.equal(1);
        });

        it("should record confirmation block", async function () {
            const blockNum = await ethers.provider.getBlockNumber();
            await wallet.connect(owner1).confirmTransaction(0);
            const confBlock = await wallet.confirmationBlocks(0, owner1.address);
            expect(confBlock).to.be.at.least(blockNum);
        });

        it("should reject double confirmation", async function () {
            await wallet.connect(owner1).confirmTransaction(0);
            await expect(
                wallet.connect(owner1).confirmTransaction(0)
            ).to.be.revertedWith("Already confirmed");
        });

        it("should reject confirmation of executed transaction", async function () {
            await wallet.connect(owner1).confirmTransaction(0);
            await wallet.connect(owner2).confirmTransaction(0);
            await wallet.connect(owner1).executeTransaction(0);
            await expect(
                wallet.connect(owner3).confirmTransaction(0)
            ).to.be.revertedWith("Already executed");
        });

        it("should not allow non-owners to confirm", async function () {
            await expect(
                wallet.connect(nonOwner).confirmTransaction(0)
            ).to.be.revertedWith("Not owner");
        });
    });

    describe("revokeConfirmation", function () {
        beforeEach(async function () {
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("1"),
                "0x"
            );
            await wallet.connect(owner1).confirmTransaction(0);
        });

        it("should revoke a confirmation", async function () {
            await wallet.connect(owner1).revokeConfirmation(0);
            const count = await wallet.getConfirmationCount(0);
            expect(count).to.equal(0);
        });

        it("should clear confirmation block on revoke", async function () {
            await wallet.connect(owner1).revokeConfirmation(0);
            const confBlock = await wallet.confirmationBlocks(0, owner1.address);
            expect(confBlock).to.equal(0);
        });

        it("should reject revoking unconfirmed transaction", async function () {
            await expect(
                wallet.connect(owner2).revokeConfirmation(0)
            ).to.be.revertedWith("Not confirmed");
        });

        it("should reject revoking executed transaction", async function () {
            await wallet.connect(owner2).confirmTransaction(0);
            await wallet.connect(owner1).executeTransaction(0);
            await expect(
                wallet.connect(owner1).revokeConfirmation(0)
            ).to.be.revertedWith("Already executed");
        });
    });

    describe("executeTransaction", function () {
        beforeEach(async function () {
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("1"),
                "0x"
            );
            await wallet.connect(owner1).confirmTransaction(0);
            await wallet.connect(owner2).confirmTransaction(0);
        });

        it("should execute a confirmed transaction", async function () {
            const balBefore = await ethers.provider.getBalance(recipient.address);
            await wallet.connect(owner1).executeTransaction(0);
            const balAfter = await ethers.provider.getBalance(recipient.address);
            expect(balAfter - balBefore).to.equal(ethers.parseEther("1"));

            const txn = await wallet.transactions(0);
            expect(txn.executed).to.be.true;
        });

        it("should not execute a transaction with insufficient confirmations", async function () {
            // Create a new tx with only 1 confirmation
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("0.5"),
                "0x"
            );
            await wallet.connect(owner1).confirmTransaction(1);

            await expect(
                wallet.connect(owner1).executeTransaction(1)
            ).to.be.revertedWith("Not enough confirmations");
        });

        it("should not execute the same transaction twice", async function () {
            await wallet.connect(owner1).executeTransaction(0);
            await expect(
                wallet.connect(owner1).executeTransaction(0)
            ).to.be.revertedWith("Already executed");
        });

        it("should prevent reentrancy - confirmation revocation during execution", async function () {
            // Deploy a malicious contract that calls revokeConfirmation in receive()
            const ReentrancyAttacker = await ethers.getContractFactory("ReentrancyAttacker");
            const attacker = await ReentrancyAttacker.deploy(await wallet.getAddress());
            await attacker.waitForDeployment();

            // Fund the attacker
            await owner1.sendTransaction({
                to: await attacker.getAddress(),
                value: ethers.parseEther("1")
            });

            // Submit a transaction to the attacker contract
            await wallet.connect(owner1).submitTransaction(
                await attacker.getAddress(),
                ethers.parseEther("1"),
                attacker.interface.encodeFunctionData("attack", [
                    ethers.parseEther("1"),
                    0 // txId 0
                ])
            );

            // Confirm by both owners
            await wallet.connect(owner1).confirmTransaction(1);
            await wallet.connect(owner2).confirmTransaction(1);

            // Execute - the attacker's callback should NOT be able to revoke
            // since nonReentrant prevents re-entry
            const balBefore = await ethers.provider.getBalance(await wallet.getAddress());
            await wallet.connect(owner1).executeTransaction(1);
            const balAfter = await ethers.provider.getBalance(await wallet.getAddress());
            expect(balAfter).to.be.lt(balBefore); // ETH was transferred
        });

        it("should not allow non-owners to execute", async function () {
            await expect(
                wallet.connect(nonOwner).executeTransaction(0)
            ).to.be.revertedWith("Not owner");
        });
    });

    describe("isConfirmedAtBlock", function () {
        it("should return true if confirmations existed at a block", async function () {
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("1"),
                "0x"
            );

            await wallet.connect(owner1).confirmTransaction(0);
            const block1 = await ethers.provider.getBlockNumber();

            // Wait a block before second confirmation
            await ethers.provider.send("evm_mine");
            await wallet.connect(owner2).confirmTransaction(0);
            const block2 = await ethers.provider.getBlockNumber();

            // At block1, only 1 confirmation existed
            expect(await wallet.isConfirmedAtBlock(0, block1)).to.be.false;
            // At block2 (current), 2 confirmations exist
            expect(await wallet.isConfirmedAtBlock(0, block2)).to.be.true;
        });

        it("should return false for non-existent transactions", async function () {
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("1"),
                "0x"
            );
            const block = await ethers.provider.getBlockNumber();
            expect(await wallet.isConfirmedAtBlock(0, block)).to.be.false;
        });
    });

    describe("Full multi-sig flow", function () {
        it("should execute an ETH transfer after 2-of-3 confirmations", async function () {
            // Owner1 submits
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("5"),
                "0x"
            );

            // Owner1 confirms
            await wallet.connect(owner1).confirmTransaction(0);
            expect(await wallet.getConfirmationCount(0)).to.equal(1);

            // Owner2 confirms (reaches required = 2)
            await wallet.connect(owner2).confirmTransaction(0);
            expect(await wallet.getConfirmationCount(0)).to.equal(2);

            // Owner1 executes
            const balBefore = await ethers.provider.getBalance(recipient.address);
            await wallet.connect(owner1).executeTransaction(0);
            const balAfter = await ethers.provider.getBalance(recipient.address);
            expect(balAfter - balBefore).to.equal(ethers.parseEther("5"));

            // Verify executed
            const txn = await wallet.transactions(0);
            expect(txn.executed).to.be.true;
        });

        it("should allow revoking and re-confirming", async function () {
            await wallet.connect(owner1).submitTransaction(
                recipient.address,
                ethers.parseEther("2"),
                "0x"
            );

            await wallet.connect(owner1).confirmTransaction(0);
            await wallet.connect(owner2).confirmTransaction(0);

            // Owner2 changes mind and revokes
            await wallet.connect(owner2).revokeConfirmation(0);
            expect(await wallet.getConfirmationCount(0)).to.equal(1);

            // Cannot execute with only 1 confirmation
            await expect(
                wallet.connect(owner1).executeTransaction(0)
            ).to.be.revertedWith("Not enough confirmations");

            // Owner3 confirms instead
            await wallet.connect(owner3).confirmTransaction(0);
            expect(await wallet.getConfirmationCount(0)).to.equal(2);

            // Execute should work now
            await wallet.connect(owner1).executeTransaction(0);
            const txn = await wallet.transactions(0);
            expect(txn.executed).to.be.true;
        });
    });
});
