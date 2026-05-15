// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/MultiSigWallet.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
}

contract CallbackOwner {
    MultiSigWallet private wallet;
    uint256 private txId;

    function confirm(MultiSigWallet targetWallet, uint256 targetTxId) external {
        targetWallet.confirmTransaction(targetTxId);
    }

    function revoke(MultiSigWallet targetWallet, uint256 targetTxId) external {
        targetWallet.revokeConfirmation(targetTxId);
    }

    function arm(MultiSigWallet targetWallet, uint256 targetTxId) external {
        wallet = targetWallet;
        txId = targetTxId;
    }

    function trigger() external {
        wallet.revokeConfirmation(txId);
    }
}

contract MultiSigWalletTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    receive() external payable {}

    function testRevocationDuringExecutionCallbackReverts() external {
        CallbackOwner callbackOwner = new CallbackOwner();
        address[] memory owners = new address[](2);
        owners[0] = address(this);
        owners[1] = address(callbackOwner);

        MultiSigWallet wallet = new MultiSigWallet(owners, 2);
        uint256 txId = wallet.submitTransaction(
            address(callbackOwner),
            0,
            abi.encodeWithSignature("trigger()")
        );
        wallet.confirmTransaction(txId);
        callbackOwner.confirm(wallet, txId);
        callbackOwner.arm(wallet, txId);

        vm.expectRevert(bytes("Confirmation revoked during execution"));
        wallet.executeTransaction(txId);
    }

    function testFrontRunRevocationPreventsExecutionInSameBlock() external {
        CallbackOwner callbackOwner = new CallbackOwner();
        address[] memory owners = new address[](2);
        owners[0] = address(this);
        owners[1] = address(callbackOwner);

        MultiSigWallet wallet = new MultiSigWallet(owners, 2);
        uint256 txId = wallet.submitTransaction(payable(address(0xBEEF)), 0, "");
        wallet.confirmTransaction(txId);
        callbackOwner.confirm(wallet, txId);
        callbackOwner.revoke(wallet, txId);

        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(txId);
    }

    function testZeroAddressSubmissionRejected() external {
        address[] memory owners = new address[](1);
        owners[0] = address(this);

        MultiSigWallet wallet = new MultiSigWallet(owners, 1);

        vm.expectRevert(bytes("Invalid target"));
        wallet.submitTransaction(address(0), 0, "");
    }

    function testSubmitConfirmRevokeConfirmExecuteEthTransfer() external {
        CallbackOwner callbackOwner = new CallbackOwner();
        address[] memory owners = new address[](2);
        owners[0] = address(this);
        owners[1] = address(callbackOwner);

        MultiSigWallet wallet = new MultiSigWallet(owners, 2);
        vm.deal(address(wallet), 1 ether);

        address payable recipient = payable(address(0xCAFE));
        uint256 txId = wallet.submitTransaction(recipient, 1 ether, "");

        wallet.confirmTransaction(txId);
        callbackOwner.confirm(wallet, txId);
        callbackOwner.revoke(wallet, txId);
        callbackOwner.confirm(wallet, txId);

        wallet.executeTransaction(txId);

        require(recipient.balance == 1 ether, "Recipient not paid");
    }
}
