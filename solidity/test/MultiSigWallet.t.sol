// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/MultiSigWallet.sol";

interface Vm {
    function deal(address account, uint256 amount) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
    function roll(uint256 newHeight) external;
}

contract RevokingCallback {
    MultiSigWallet private wallet;
    uint256 public txId;
    bool public revokeAttempted;
    bool public revokeBlocked;

    function setWallet(MultiSigWallet _wallet) external {
        wallet = _wallet;
    }

    function setTxId(uint256 _txId) external {
        txId = _txId;
    }

    function onExecute() external {
        revokeAttempted = true;
        try wallet.revokeConfirmation(txId) {
            revokeBlocked = false;
        } catch {
            revokeBlocked = true;
        }
    }
}

contract MultiSigWalletTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private owner2 = address(0xB0B);
    address private owner3 = address(0xC0B);
    address private recipient = address(0xDAD);

    MultiSigWallet private wallet;

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = address(this);
        owners[1] = owner2;
        owners[2] = owner3;
        wallet = new MultiSigWallet(owners, 2);
        vm.deal(address(wallet), 10 ether);
    }

    function testZeroAddressTransactionsAreRejected() public {
        vm.expectRevert(bytes("Invalid target"));
        wallet.submitTransaction(address(0), 0, "");
    }

    function testCallDataToNonContractIsRejected() public {
        vm.expectRevert(bytes("Target has no code"));
        wallet.submitTransaction(recipient, 0, abi.encodeWithSignature("missing()"));
    }

    function testFrontRunningRevocationBlocksExecution() public {
        uint256 txId = wallet.submitTransaction(recipient, 1 ether, "");
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        vm.roll(block.number + 1);
        vm.prank(owner2);
        wallet.revokeConfirmation(txId);

        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(txId);
    }

    function testIsConfirmedAtBlockTracksRevocationHistory() public {
        uint256 txId = wallet.submitTransaction(recipient, 0, "");
        wallet.confirmTransaction(txId);
        uint256 confirmedBlock = block.number;

        vm.roll(block.number + 1);
        wallet.revokeConfirmation(txId);
        uint256 revokedBlock = block.number;

        require(wallet.isConfirmedAtBlock(txId, address(this), confirmedBlock), "missing historical confirmation");
        require(!wallet.isConfirmedAtBlock(txId, address(this), revokedBlock), "revocation ignored");
    }

    function testRevocationDuringCallbackIsBlocked() public {
        address[] memory owners = new address[](2);
        owners[0] = address(this);
        RevokingCallback callback = new RevokingCallback();
        owners[1] = address(callback);

        MultiSigWallet callbackWallet = new MultiSigWallet(owners, 2);
        callback.setWallet(callbackWallet);
        vm.deal(address(callbackWallet), 1 ether);

        uint256 txId = callbackWallet.submitTransaction(address(callback), 0, abi.encodeWithSignature("onExecute()"));
        callback.setTxId(txId);
        callbackWallet.confirmTransaction(txId);

        vm.prank(address(callback));
        callbackWallet.confirmTransaction(txId);

        callbackWallet.executeTransaction(txId);

        require(callback.revokeAttempted(), "callback did not attempt revoke");
        require(callback.revokeBlocked(), "callback revoke was not blocked");
        (,,, bool executed) = callbackWallet.transactions(txId);
        require(executed, "transaction not executed");
    }

    function testSimpleEthTransferExecutesUnderGasLimit() public {
        uint256 txId = wallet.submitTransaction(recipient, 1 ether, "");
        wallet.confirmTransaction(txId);

        vm.prank(owner2);
        wallet.confirmTransaction(txId);

        uint256 beforeBalance = recipient.balance;
        uint256 gasBefore = gasleft();
        wallet.executeTransaction(txId);
        uint256 gasUsed = gasBefore - gasleft();

        require(recipient.balance == beforeBalance + 1 ether, "recipient not paid");
        require(gasUsed < 100_000, "execute gas too high");
    }
}
