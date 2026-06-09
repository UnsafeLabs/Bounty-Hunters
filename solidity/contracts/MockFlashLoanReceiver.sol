// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    function executeFlashLoan(address pool, uint256 amount) external {
        FlashLoan(pool).flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external override {
        // Transfer the loan amount plus fee back to the pool to repay it
        IERC20(token).transfer(msg.sender, amount + fee);
    }
}
