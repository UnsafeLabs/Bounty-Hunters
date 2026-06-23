// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FlashLoanReceiverMock is IFlashLoanReceiver {
    bool public shouldFailRepayment;

    function setFailRepayment(bool _fail) external {
        shouldFailRepayment = _fail;
    }

    function executeLoan(address pool, uint256 amount) external {
        IERC20(FlashLoan(pool).loanToken()).approve(pool, type(uint256).max);
        FlashLoan(pool).flashLoan(amount, "");
    }

    function onFlashLoan(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata /* data */
    ) external override {
        if (!shouldFailRepayment) {
            // Repay loan + fee
            IERC20(token).transfer(msg.sender, amount + fee);
        }
    }
}
