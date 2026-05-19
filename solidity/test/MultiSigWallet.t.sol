// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MultiSigWallet.sol";

contract MockTarget {
    MultiSigWallet public wallet;
    uint256 public txIdToRevoke;
    address public maliciousOwner;
    bool public attemptRevoke;

    function setConfig(MultiSigWallet _wallet, uint256 _txId, address _owner) external {
        wallet = _wallet;
        txIdToRevoke = _txId;
        maliciousOwner = _owner;
    }

    function setAttemptRevoke(bool _attempt) external {
        attemptRevoke = _attempt;
    }

    fallback() external payable {
        if (attemptRevoke) {
            // Attempt to revoke confirmation during execution
            wallet.revokeConfirmation(txIdToRevoke);
        }
    }

    receive() external payable {
        if (attemptRevoke) {
            wallet.revokeConfirmation(txIdToRevoke);
        }
    }
}

contract MultiSigWalletTest is Test {
    MultiSigWallet public wallet;
    address[] public owners;
    MockTarget public target;

    address public owner1 = address(0x11);
    address public owner2 = address(0x22);
    address public owner3 = address(0x33);

    function setUp() public {
        owners.push(owner1);
        owners.push(owner2);
        owners.push(owner3);

        wallet = new MultiSigWallet(owners, 2);
        target = new MockTarget();
        vm.deal(address(wallet), 100 ether);
    }

    function test_ZeroAddressRejection() public {
        vm.startPrank(owner1);
        vm.expectRevert("Zero address");
        wallet.submitTransaction(address(0), 1 ether, "");
        vm.stopPrank();
    }

    function test_CodeSizeRejection() public {
        vm.startPrank(owner1);
        vm.expectRevert("Target must be a contract if data is provided");
        wallet.submitTransaction(owner2, 1 ether, "0x1234");
        vm.stopPrank();
    }

    function test_SimpleEthTransferGas() public {
        vm.startPrank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        vm.startPrank(owner2);
        wallet.confirmTransaction(txId);
        
        uint256 gasStart = gasleft();
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasStart - gasleft();
        vm.stopPrank();

        assertLt(gasUsed, 100000);
        assertEq(owner2.balance, 1 ether);
    }

    function test_RevocationDuringCallback() public {
        vm.startPrank(owner1);
        uint256 txId = wallet.submitTransaction(address(target), 1 ether, "0xdeadbeef");
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        vm.startPrank(owner2);
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        target.setConfig(wallet, txId, owner1);
        target.setAttemptRevoke(true);

        vm.startPrank(owner1);
        // The call will fail due to reentrancy guard or revocation check
        vm.expectRevert();
        wallet.executeTransaction(txId);
        vm.stopPrank();
    }

    function test_FrontRunningRevocationCheck() public {
        // Roll to block 10
        vm.roll(10);
        
        vm.startPrank(owner1);
        uint256 txId = wallet.submitTransaction(owner2, 1 ether, "");
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        vm.startPrank(owner2);
        wallet.confirmTransaction(txId);
        vm.stopPrank();

        // owner1 revokes at block 11
        vm.roll(11);
        vm.startPrank(owner1);
        wallet.revokeConfirmation(txId);
        vm.stopPrank();

        // executeTransaction at block 11 shouldn't work because getConfirmationCount is now 1
        vm.startPrank(owner2);
        vm.expectRevert("Not enough confirmations at current block");
        wallet.executeTransaction(txId);
        vm.stopPrank();
    }
}
