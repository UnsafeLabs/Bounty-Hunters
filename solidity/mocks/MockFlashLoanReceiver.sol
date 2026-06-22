// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockFlashLoanReceiver - A mock receiver for testing flash loans
contract MockFlashLoanReceiver {
    bool public shouldRepay = true;
    bool public shouldRepayExtra = false;
    uint256 public extraRepayAmount = 0;

    function setRepayment(bool _shouldRepay) external {
        shouldRepay = _shouldRepay;
    }

    function setExtraRepayment(uint256 _extraRepayAmount) external {
        shouldRepayExtra = true;
        extraRepayAmount = _extraRepayAmount;
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        if (shouldRepay) {
            uint256 repayAmount = amount + fee;
            if (shouldRepayExtra) {
                repayAmount += extraRepayAmount;
            }
            IERC20(token).transfer(msg.sender, repayAmount);
        }
        // If shouldRepay is false, we don't repay (simulating a failed flash loan)
    }
}
