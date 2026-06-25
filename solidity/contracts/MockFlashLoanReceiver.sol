// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    bool public doRepay = true;

    function setDoRepay(bool _doRepay) external {
        doRepay = _doRepay;
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata /* data */) external override {
        if (doRepay) {
            // Transfer amount + fee back to FlashLoan contract
            IERC20(token).transfer(msg.sender, amount + fee);
        }
    }

    function initiateFlashLoan(address vault, uint256 amount) external {
        FlashLoan(vault).flashLoan(amount, "");
    }
}
