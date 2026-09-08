// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/MultiSigWallet.sol";

contract MultiSigWalletTest {
    MultiSigWallet public wallet;
    address public owner1;
    address public owner2;
    address public owner3;
    address public nonOwner;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        owner1 = address(0x1);
        owner2 = address(0x2);
        owner3 = address(0x3);
        nonOwner = address(0x4);
        
        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        
        wallet = new MultiSigWallet(owners, 2);
    }
    
    function testSubmitTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 100, "");
        
        if (wallet.transactions(txId).to == owner2) {
            emit TestPassed("Submit transaction works");
        } else {
            emit TestFailed("Submit transaction failed");
        }
    }
    
    function testZeroAddressRejection() public {
        vm.prank(owner1);
        try wallet.submitTransaction(address(0), 100, "") {
            emit TestFailed("Should reject zero address");
        } catch {
            emit TestPassed("Zero address transaction rejected");
        }
    }
    
    function testNoCodeNoValueRejection() public {
        // Create a fresh address with no code
        address noCodeAddress = address(0x123);
        
        vm.prank(owner1);
        try wallet.submitTransaction(noCodeAddress, 0, "") {
            emit TestFailed("Should reject no code and no value");
        } catch {
            emit TestPassed("No code and no value transaction rejected");
        }
    }
    
    function testConfirmTransaction() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        if (wallet.getConfirmationCount(txId) == 2) {
            emit TestPassed("Confirm transaction works");
        } else {
            emit TestFailed("Confirm transaction failed");
        }
    }
    
    function testRevokeConfirmation() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        wallet.revokeConfirmation(txId);
        
        if (!wallet.confirmations(txId)[owner1].confirmed) {
            emit TestPassed("Revoke confirmation works");
        } else {
            emit TestFailed("Revoke confirmation failed");
        }
    }
    
    function testExecuteTransaction() public {
        // Fund the wallet
        vm.deal(address(wallet), 1000);
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 initialBalance = owner2.balance;
        
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        
        if (owner2.balance == initialBalance + 100) {
            emit TestPassed("Execute transaction works");
        } else {
            emit TestFailed("Execute transaction failed");
        }
    }
    
    function testReentrancyProtection() public {
        // Create a malicious contract that tries to re-enter
        MaliciousContract malicious = new MaliciousContract(address(wallet));
        
        // Fund the wallet
        vm.deal(address(wallet), 1000);
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(malicious), 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner1);
        try wallet.executeTransaction(txId) {
            emit TestFailed("Should prevent reentrancy");
        } catch {
            emit TestPassed("Reentrancy protection works");
        }
    }
    
    function testConfirmationRevocationDuringCallback() public {
        // Create a contract that revokes confirmation during callback
        RevokingContract revoking = new RevokingContract(address(wallet), owner2);
        
        // Fund the wallet
        vm.deal(address(wallet), 1000);
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(address(revoking), 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        // Set up the revoking contract to revoke during execution
        revoking.setTxId(txId);
        
        uint256 initialBalance = owner2.balance;
        
        vm.prank(owner1);
        try wallet.executeTransaction(txId) {
            emit TestFailed("Should prevent execution if confirmation revoked during callback");
        } catch {
            emit TestPassed("Confirmation revocation during callback prevented");
        }
    }
    
    function testFrontRunningRevocation() public {
        // Fund the wallet
        vm.deal(address(wallet), 1000);
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        // Get the current block number
        uint256 currentBlock = block.number;
        
        // Owner2 revokes confirmation
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);
        
        // Try to execute - should fail because confirmation was revoked
        vm.prank(owner1);
        try wallet.executeTransaction(txId) {
            emit TestFailed("Should prevent execution after revocation");
        } catch {
            emit TestPassed("Front-running revocation prevented");
        }
    }
    
    function testIsConfirmedAtBlock() public {
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        uint256 confirmBlock = block.number;
        
        // Should be confirmed at current block
        if (wallet.isConfirmedAtBlock(txId, owner1, confirmBlock)) {
            emit TestPassed("isConfirmedAtBlock returns true for confirmed owner");
        } else {
            emit TestFailed("isConfirmedAtBlock should return true");
        }
        
        // Should not be confirmed at block before confirmation
        if (!wallet.isConfirmedAtBlock(txId, owner1, confirmBlock - 1)) {
            emit TestPassed("isConfirmedAtBlock returns false for block before confirmation");
        } else {
            emit TestFailed("isConfirmedAtBlock should return false for earlier block");
        }
    }
    
    function testGasCost() public {
        // Fund the wallet
        vm.deal(address(wallet), 1000);
        
        vm.prank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 100, "");
        
        vm.prank(owner1);
        wallet.confirmTransaction(txId);
        
        vm.prank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 gasBefore = gasleft();
        vm.prank(owner1);
        wallet.executeTransaction(txId);
        uint256 gasAfter = gasleft();
        
        uint256 gasUsed = gasBefore - gasAfter;
        
        if (gasUsed < 100000) {
            emit TestPassed("Gas cost for executeTransaction is under 100,000");
        } else {
            emit TestFailed("Gas cost exceeds 100,000");
        }
    }
}

contract MaliciousContract {
    address public wallet;
    
    constructor(address _wallet) {
        wallet = _wallet;
    }
    
    function maliciousFunction() external payable {
        // Try to re-enter the wallet
        MultiSigWallet(wallet).executeTransaction(0);
    }
    
    receive() external payable {
        maliciousFunction();
    }
}

contract RevokingContract {
    address public wallet;
    address public owner;
    uint256 public txId;
    
    constructor(address _wallet, address _owner) {
        wallet = _wallet;
        owner = _owner;
    }
    
    function setTxId(uint256 _txId) external {
        txId = _txId;
    }
    
    function revokeDuringExecution() external {
        // Try to revoke confirmation during execution
        MultiSigWallet(wallet).revokeConfirmation(txId);
    }
    
    receive() external payable {
        revokeDuringExecution();
    }
}
