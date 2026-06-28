// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../FlashLoan.sol";

interface IRebasingFlashLoanToken {
    function rebase() external;
}

contract FlashLoanReceiver is IFlashLoanReceiver {
    address public lender;
    uint256 public lastAmount;
    uint256 public lastFee;
    bool public rebaseDuringCallback;

    constructor(address _lender) {
        lender = _lender;
    }

    function setRebaseDuringCallback(bool enabled) external {
        rebaseDuringCallback = enabled;
    }

    function request(uint256 amount, bytes calldata data) external {
        FlashLoan(lender).flashLoan(amount, data);
    }

    function onFlashLoan(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external override {
        require(msg.sender == lender, "Invalid lender");

        lastAmount = amount;
        lastFee = fee;

        if (rebaseDuringCallback) {
            IRebasingFlashLoanToken(token).rebase();
        }

        require(IERC20(token).transfer(msg.sender, amount + fee), "Repay failed");
    }
}
